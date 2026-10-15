import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import type { MusicVaultClient } from "./supabase/client";

/**
 * Client for the `vault` Edge Function (docs/drive-to-r2-migration.md §2.3)
 * plus the vault's SQL functions. The function hands out short-lived
 * pre-signed R2 URLs; the bytes themselves go straight between the device
 * and R2. Desktop and web use this directly; Android mirrors it over OkHttp.
 */

export type VaultArtVariant = "full" | "thumb";

export interface SignedGet {
  /** key → pre-signed GET URL, for every key the caller may read. */
  urls: Record<string, string>;
  /** Keys refused: not the caller's, or not referenced by a live track. */
  denied: string[];
  expiresIn: number;
}

export interface SignedPut {
  key: string;
  url: string;
  expiresIn: number;
}

export interface CommitResult {
  trackId: string;
  storageKey: string;
  size: number;
}

/** A refusal or failure reported by the vault (HTTP status + machine code). */
export class VaultError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "VaultError";
    this.status = status;
    this.code = code;
  }
}

/** The vault couldn't be reached at all — retry when back online. */
export class VaultNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultNetworkError";
  }
}

/** Sends one request body to the function and returns its JSON reply, or throws a Vault*Error. */
export type VaultInvoker = (body: Record<string, unknown>) => Promise<unknown>;

export const VAULT_FUNCTION = "vault";
export const MAX_KEYS_PER_SIGN_GET = 200;

export function supabaseVaultInvoker(client: MusicVaultClient): VaultInvoker {
  return async (body) => {
    const { data, error } = await client.functions.invoke(VAULT_FUNCTION, { body });
    if (!error) return data;
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      let reply: { error?: string; message?: string } = {};
      try {
        reply = (await res.json()) as typeof reply;
      } catch {
        // non-JSON error body (gateway) — fall through with the status only
      }
      throw new VaultError(res.status, reply.error ?? "http_error", reply.message ?? `vault returned ${res.status}`);
    }
    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      throw new VaultNetworkError(error.message);
    }
    throw new VaultNetworkError(error instanceof Error ? error.message : String(error));
  };
}

export interface VaultApi {
  signGet(keys: string[]): Promise<SignedGet>;
  signPutAudio(trackId: string, ext: string): Promise<SignedPut>;
  signPutArt(sha256: string, variant: VaultArtVariant, size: number): Promise<SignedPut>;
  /** Confirms an uploaded audio object and records it on the track (revives a deleted one). */
  commit(trackId: string, ext: string): Promise<CommitResult>;
  /** "Delete from vault": tombstones the track and removes its objects. */
  remove(trackId: string): Promise<void>;
  /**
   * The existing row an upload of this file should attach to (same content
   * hash, including a deleted track it revives), or null for a new song.
   */
  resolveUploadTarget(contentHash: string): Promise<string | null>;
}

export function createVaultApi(invoke: VaultInvoker, rpc: VaultRpc): VaultApi {
  return {
    async signGet(keys) {
      if (keys.length === 0) return { urls: {}, denied: [], expiresIn: 0 };
      const merged: SignedGet = { urls: {}, denied: [], expiresIn: Infinity };
      for (let i = 0; i < keys.length; i += MAX_KEYS_PER_SIGN_GET) {
        const part = (await invoke({ action: "sign-get", keys: keys.slice(i, i + MAX_KEYS_PER_SIGN_GET) })) as SignedGet;
        Object.assign(merged.urls, part.urls);
        merged.denied.push(...part.denied);
        merged.expiresIn = Math.min(merged.expiresIn, part.expiresIn);
      }
      return merged;
    },
    async signPutAudio(trackId, ext) {
      return (await invoke({ action: "sign-put", kind: "audio", trackId, ext })) as SignedPut;
    },
    async signPutArt(sha256, variant, size) {
      return (await invoke({ action: "sign-put", kind: "art", sha256, variant, size })) as SignedPut;
    },
    async commit(trackId, ext) {
      return (await invoke({ action: "commit", trackId, ext })) as CommitResult;
    },
    async remove(trackId) {
      await invoke({ action: "delete", trackId });
    },
    resolveUploadTarget: (contentHash) => rpc.resolveUploadTarget(contentHash),
  };
}

/** The vault's SQL entry points (separate from the function so tests can fake them). */
export interface VaultRpc {
  resolveUploadTarget(contentHash: string): Promise<string | null>;
}

export function supabaseVaultRpc(client: MusicVaultClient): VaultRpc {
  return {
    async resolveUploadTarget(contentHash) {
      // p_md5 (old Drive-row linking) goes away with the Drive columns at M7.
      const { data, error } = await client.rpc("resolve_upload_target", { p_content_hash: contentHash, p_md5: null });
      if (error) {
        if (/fetch|network|abort|timeout/i.test(error.message)) throw new VaultNetworkError(error.message);
        throw new VaultError(400, error.code ?? "rpc_error", error.message);
      }
      return (data as string | null) ?? null;
    },
  };
}

/** The production API over a signed-in client. */
export function createSupabaseVaultApi(client: MusicVaultClient): VaultApi {
  return createVaultApi(supabaseVaultInvoker(client), supabaseVaultRpc(client));
}

/** The thumbnail key belonging to a full-size cover key. */
export function thumbKeyOf(artworkKey: string): string {
  return artworkKey.replace(/\.jpg$/, ".thumb.jpg");
}

/**
 * Remembers signed GET URLs until shortly before they expire, so lists of
 * covers and repeated plays don't re-sign. Keys the vault denies are not
 * cached (they may become readable once an upload commits).
 */
export class SignedUrlCache {
  private readonly entries = new Map<string, { url: string; expiresAt: number }>();
  private readonly api: Pick<VaultApi, "signGet">;
  private readonly now: () => number;
  private readonly marginMs: number;

  constructor(api: Pick<VaultApi, "signGet">, opts: { now?: () => number; marginSeconds?: number } = {}) {
    this.api = api;
    this.now = opts.now ?? Date.now;
    this.marginMs = (opts.marginSeconds ?? 120) * 1000;
  }

  /** URLs for the readable subset of `keys` (missing entries were denied). */
  async get(keys: string[]): Promise<Record<string, string>> {
    const now = this.now();
    const out: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of new Set(keys)) {
      const hit = this.entries.get(key);
      if (hit && hit.expiresAt - this.marginMs > now) out[key] = hit.url;
      else missing.push(key);
    }
    if (missing.length > 0) {
      const signed = await this.api.signGet(missing);
      const expiresAt = now + signed.expiresIn * 1000;
      for (const [key, url] of Object.entries(signed.urls)) {
        this.entries.set(key, { url, expiresAt });
        out[key] = url;
      }
    }
    return out;
  }

  async getOne(key: string): Promise<string | null> {
    return (await this.get([key]))[key] ?? null;
  }

  invalidate(key?: string): void {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}

/**
 * Content hashes of tracks deleted from the vault — tombstoned rows with no
 * live row sharing the hash (a re-upload revives the same row, but guard
 * anyway). Clients drop their local copies of these. Rows a client hasn't
 * pulled are simply absent, so they never count.
 */
export function deletedVaultHashes(rows: Array<{ content_hash: string | null; deleted_at: string | null }>): string[] {
  const live = new Set(rows.filter((r) => !r.deleted_at && r.content_hash).map((r) => r.content_hash!));
  const gone = new Set<string>();
  for (const r of rows) if (r.deleted_at && r.content_hash && !live.has(r.content_hash)) gone.add(r.content_hash);
  return [...gone];
}
