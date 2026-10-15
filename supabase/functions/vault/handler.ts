// The vault Edge Function's request handling, free of Deno and network
// specifics so it can be unit-tested with fakes (handler.test.ts). index.ts
// wires it to Supabase and R2. Contract: docs/drive-to-r2-migration.md §2.3.
//
// Every request is POST JSON { action, ... } with the caller's Supabase JWT.
// Database access goes through the caller's own client (RLS applies) except
// markStored, the one write that needs the service role.

import {
  artKey,
  audioKey,
  isAudioExt,
  isHex64,
  isUuid,
  MAX_ART_BYTES,
  MAX_AUDIO_BYTES,
  parseKey,
  thumbKeyOf,
} from "./keys.ts";

export const GET_TTL_SECONDS = 3600;
export const PUT_TTL_SECONDS = 900;
export const MAX_KEYS_PER_SIGN_GET = 200;

export interface TrackRow {
  id: string;
  content_hash: string | null;
  file_size: number;
}

/** Queries made as the caller (RLS-scoped to their own rows). */
export interface UserDb {
  /** Live or deleted (a deleted track is revived by a re-upload). */
  getTrack(id: string): Promise<TrackRow | null>;
  /** The subset of `keys` that a live track of the caller stores as audio. */
  referencedStorageKeys(keys: string[]): Promise<Set<string>>;
  /** The subset of `keys` that a live track of the caller uses as its cover. */
  referencedArtworkKeys(keys: string[]): Promise<Set<string>>;
  /** Runs `delete_track`; null when the track doesn't exist or isn't the caller's. */
  deleteTrack(id: string): Promise<{ storageKey: string | null; artworkKey: string | null; artworkStillUsed: boolean } | null>;
}

/** Service-role writes. The caller's ownership is checked before these run. */
export interface AdminDb {
  /** Records a confirmed upload; also revives a deleted track. */
  markStored(trackId: string, storageKey: string): Promise<void>;
}

export interface ObjectStore {
  presign(method: "GET" | "PUT", key: string, ttlSeconds: number): Promise<string>;
  /** Object size in bytes, or null when it doesn't exist. */
  size(key: string): Promise<number | null>;
  /** Deletes the object; a missing object is not an error. */
  remove(key: string): Promise<void>;
}

export interface Caller {
  userId: string;
  db: UserDb;
}

export interface VaultDeps {
  /** The caller from the request's Authorization header, or null. */
  authenticate(req: Request): Promise<Caller | null>;
  admin: AdminDb;
  store: ObjectStore;
  log?: (message: string, error: unknown) => void;
}

// supabase.functions.invoke from the web app is a cross-origin request.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class VaultError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type Body = Record<string, unknown>;

export function createHandler(deps: VaultDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((message, error) => console.error(message, error));

  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    try {
      if (req.method !== "POST") throw new VaultError(405, "method_not_allowed", "Use POST");
      const caller = await deps.authenticate(req);
      if (!caller) throw new VaultError(401, "unauthorized", "Sign in first");

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new VaultError(400, "bad_request", "Body must be JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new VaultError(400, "bad_request", "Body must be a JSON object");
      }
      const b = body as Body;

      switch (b.action) {
        case "sign-get":
          return json(200, await signGet(caller, deps, b));
        case "sign-put":
          return json(200, await signPut(caller, deps, b));
        case "commit":
          return json(200, await commit(caller, deps, b));
        case "delete":
          return json(200, await remove(caller, deps, b));
        default:
          throw new VaultError(400, "unknown_action", "Unknown action");
      }
    } catch (e) {
      if (e instanceof VaultError) return json(e.status, { error: e.code, message: e.message });
      log("vault request failed", e);
      return json(500, { error: "internal", message: "Vault request failed" });
    }
  };
}

// ---------------------------------------------------------------- sign-get

async function signGet(caller: Caller, deps: VaultDeps, b: Body) {
  const keys = b.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS_PER_SIGN_GET) {
    throw new VaultError(400, "bad_request", `keys must be 1–${MAX_KEYS_PER_SIGN_GET} object keys`);
  }

  const audio: string[] = [];
  const art = new Map<string, string>(); // requested key → full cover key
  const denied: string[] = [];
  for (const key of new Set(keys)) {
    const parsed = parseKey(key);
    if (!parsed || parsed.userId !== caller.userId) {
      denied.push(String(key));
    } else if (parsed.kind === "audio") {
      audio.push(key as string);
    } else {
      art.set(key as string, parsed.fullKey);
    }
  }

  const [ownAudio, ownArt] = await Promise.all([
    audio.length ? caller.db.referencedStorageKeys(audio) : Promise.resolve(new Set<string>()),
    art.size ? caller.db.referencedArtworkKeys([...new Set(art.values())]) : Promise.resolve(new Set<string>()),
  ]);

  const allowed: string[] = [];
  for (const key of audio) (ownAudio.has(key) ? allowed : denied).push(key);
  for (const [key, full] of art) (ownArt.has(full) ? allowed : denied).push(key);

  const urls: Record<string, string> = {};
  await Promise.all(
    allowed.map(async (key) => {
      urls[key] = await deps.store.presign("GET", key, GET_TTL_SECONDS);
    }),
  );
  return { urls, denied, expiresIn: GET_TTL_SECONDS };
}

// ---------------------------------------------------------------- sign-put

async function signPut(caller: Caller, deps: VaultDeps, b: Body) {
  if (b.kind === "audio") {
    if (!isUuid(b.trackId)) throw new VaultError(400, "bad_request", "trackId must be a UUID");
    if (!isAudioExt(b.ext)) throw new VaultError(400, "bad_request", "Unsupported audio extension");
    const track = await caller.db.getTrack(b.trackId);
    if (!track) throw new VaultError(404, "track_not_found", "Track not found");
    if (!isHex64(track.content_hash)) throw new VaultError(409, "no_hash", "Track has no content hash");
    if (track.file_size > MAX_AUDIO_BYTES) throw new VaultError(413, "too_large", "Audio file is too large");
    const key = audioKey(caller.userId, track.content_hash, b.ext);
    return { key, url: await deps.store.presign("PUT", key, PUT_TTL_SECONDS), expiresIn: PUT_TTL_SECONDS };
  }

  if (b.kind === "art") {
    if (!isHex64(b.sha256)) throw new VaultError(400, "bad_request", "sha256 must be 64 hex characters");
    if (b.variant !== "full" && b.variant !== "thumb") {
      throw new VaultError(400, "bad_request", "variant must be full or thumb");
    }
    if (typeof b.size !== "number" || !(b.size > 0)) throw new VaultError(400, "bad_request", "size is required");
    if (b.size > MAX_ART_BYTES) throw new VaultError(413, "too_large", "Cover image is too large");
    const key = artKey(caller.userId, b.sha256, b.variant);
    return { key, url: await deps.store.presign("PUT", key, PUT_TTL_SECONDS), expiresIn: PUT_TTL_SECONDS };
  }

  throw new VaultError(400, "bad_request", "kind must be audio or art");
}

// ---------------------------------------------------------------- commit

async function commit(caller: Caller, deps: VaultDeps, b: Body) {
  if (!isUuid(b.trackId)) throw new VaultError(400, "bad_request", "trackId must be a UUID");
  if (!isAudioExt(b.ext)) throw new VaultError(400, "bad_request", "Unsupported audio extension");
  const track = await caller.db.getTrack(b.trackId);
  if (!track) throw new VaultError(404, "track_not_found", "Track not found");
  if (!isHex64(track.content_hash)) throw new VaultError(409, "no_hash", "Track has no content hash");

  const key = audioKey(caller.userId, track.content_hash, b.ext);
  const size = await deps.store.size(key);
  if (size === null) throw new VaultError(409, "not_uploaded", "No uploaded object for this track");
  if (size > MAX_AUDIO_BYTES) {
    await deps.store.remove(key);
    throw new VaultError(413, "too_large", "Audio file is too large");
  }
  if (track.file_size > 0 && size !== track.file_size) {
    // A partial or wrong upload: drop it so a retry starts clean.
    await deps.store.remove(key);
    throw new VaultError(409, "size_mismatch", `Uploaded ${size} bytes, expected ${track.file_size}`);
  }

  await deps.admin.markStored(track.id, key);
  return { trackId: track.id, storageKey: key, size };
}

// ---------------------------------------------------------------- delete

async function remove(caller: Caller, deps: VaultDeps, b: Body) {
  if (!isUuid(b.trackId)) throw new VaultError(400, "bad_request", "trackId must be a UUID");
  const result = await caller.db.deleteTrack(b.trackId);
  if (!result) throw new VaultError(404, "track_not_found", "Track not found");

  // The row is already a tombstone; an object left behind by a failed delete
  // here is unreachable (sign-get refuses unreferenced keys), so it only costs
  // storage — log it rather than fail the user's delete.
  const doomed: string[] = [];
  if (result.storageKey) doomed.push(result.storageKey);
  if (result.artworkKey && !result.artworkStillUsed) doomed.push(result.artworkKey, thumbKeyOf(result.artworkKey));
  const outcomes = await Promise.allSettled(doomed.map((key) => deps.store.remove(key)));
  outcomes.forEach((o, i) => {
    if (o.status === "rejected") (deps.log ?? console.error)(`could not delete object ${doomed[i]}`, o.reason);
  });

  return { trackId: b.trackId, deleted: true };
}
