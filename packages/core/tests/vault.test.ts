import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { MusicVaultClient } from "../src/supabase/client";
import {
  createVaultApi,
  deletedVaultHashes,
  MAX_KEYS_PER_SIGN_GET,
  SignedUrlCache,
  supabaseVaultInvoker,
  thumbKeyOf,
  type VaultApi,
  VaultError,
  VaultNetworkError,
} from "../src/vault";

const noRpc = { resolveUploadTarget: async () => null };

describe("createVaultApi", () => {
  it("sends each action with the documented body", async () => {
    const sent: Record<string, unknown>[] = [];
    const api = createVaultApi(async (body) => {
      sent.push(body);
      return { urls: {}, denied: [], expiresIn: 3600, key: "k", url: "u", trackId: "t", storageKey: "s", size: 1 };
    }, noRpc);
    await api.signPutAudio("t1", "flac");
    await api.signPutArt("a".repeat(64), "thumb", 10);
    await api.commit("t1", "flac");
    await api.remove("t1");
    expect(sent).toEqual([
      { action: "sign-put", kind: "audio", trackId: "t1", ext: "flac" },
      { action: "sign-put", kind: "art", sha256: "a".repeat(64), variant: "thumb", size: 10 },
      { action: "commit", trackId: "t1", ext: "flac" },
      { action: "delete", trackId: "t1" },
    ]);
  });

  it("splits large sign-get requests and merges the replies", async () => {
    const batches: number[] = [];
    const api = createVaultApi(async (body) => {
      const keys = body.keys as string[];
      batches.push(keys.length);
      return {
        urls: Object.fromEntries(keys.filter((k) => !k.endsWith("x")).map((k) => [k, `url:${k}`])),
        denied: keys.filter((k) => k.endsWith("x")),
        expiresIn: batches.length === 1 ? 3600 : 1800,
      };
    }, noRpc);
    const keys = Array.from({ length: MAX_KEYS_PER_SIGN_GET + 5 }, (_, i) => `k${i}${i === 3 ? "x" : ""}`);
    const result = await api.signGet(keys);
    expect(batches).toEqual([MAX_KEYS_PER_SIGN_GET, 5]);
    expect(Object.keys(result.urls)).toHaveLength(keys.length - 1);
    expect(result.denied).toEqual(["k3x"]);
    expect(result.expiresIn).toBe(1800);
    expect(await api.signGet([])).toEqual({ urls: {}, denied: [], expiresIn: 0 });
  });

  it("derives thumbnail keys", () => {
    expect(thumbKeyOf("users/u/art/abc.jpg")).toBe("users/u/art/abc.thumb.jpg");
  });
});

describe("supabaseVaultInvoker", () => {
  const clientReturning = (result: { data: unknown; error: unknown }) =>
    ({ functions: { invoke: async () => result } }) as unknown as MusicVaultClient;

  it("returns the function's JSON on success", async () => {
    const invoke = supabaseVaultInvoker(clientReturning({ data: { ok: 1 }, error: null }));
    expect(await invoke({ action: "x" })).toEqual({ ok: 1 });
  });

  it("maps a non-2xx reply to a VaultError with the function's code", async () => {
    const res = new Response(JSON.stringify({ error: "not_uploaded", message: "No uploaded object" }), { status: 409 });
    const invoke = supabaseVaultInvoker(clientReturning({ data: null, error: new FunctionsHttpError(res) }));
    const err = await invoke({ action: "commit" }).catch((e) => e);
    expect(err).toBeInstanceOf(VaultError);
    expect(err).toMatchObject({ status: 409, code: "not_uploaded", message: "No uploaded object" });
  });

  it("maps a non-JSON error body to a generic code", async () => {
    const res = new Response("Bad gateway", { status: 502 });
    const invoke = supabaseVaultInvoker(clientReturning({ data: null, error: new FunctionsHttpError(res) }));
    await expect(invoke({})).rejects.toMatchObject({ status: 502, code: "http_error" });
  });

  it("maps fetch failures to VaultNetworkError", async () => {
    const invoke = supabaseVaultInvoker(
      clientReturning({ data: null, error: new FunctionsFetchError(new TypeError("fetch failed")) }),
    );
    await expect(invoke({})).rejects.toBeInstanceOf(VaultNetworkError);
  });
});

describe("SignedUrlCache", () => {
  function fakeApi() {
    const calls: string[][] = [];
    const api: Pick<VaultApi, "signGet"> = {
      async signGet(keys) {
        calls.push(keys);
        return {
          urls: Object.fromEntries(keys.filter((k) => k !== "denied").map((k) => [k, `url:${k}:${calls.length}`])),
          denied: keys.filter((k) => k === "denied"),
          expiresIn: 3600,
        };
      },
    };
    return { api, calls };
  }

  it("reuses URLs until shortly before they expire", async () => {
    let now = 0;
    const { api, calls } = fakeApi();
    const cache = new SignedUrlCache(api, { now: () => now, marginSeconds: 120 });

    expect(await cache.get(["a", "b"])).toEqual({ a: "url:a:1", b: "url:b:1" });
    now = 3000 * 1000;
    expect(await cache.get(["a", "c"])).toEqual({ a: "url:a:1", c: "url:c:2" });
    expect(calls).toEqual([["a", "b"], ["c"]]);

    now = 3500 * 1000; // inside the 120 s margin before a's expiry
    expect(await cache.getOne("a")).toBe("url:a:3");
  });

  it("doesn't cache denied keys and can be invalidated", async () => {
    const { api, calls } = fakeApi();
    const cache = new SignedUrlCache(api);
    expect(await cache.getOne("denied")).toBeNull();
    expect(await cache.getOne("denied")).toBeNull();
    await cache.getOne("a");
    cache.invalidate("a");
    await cache.getOne("a");
    expect(calls).toEqual([["denied"], ["denied"], ["a"], ["a"]]);
  });
});

describe("deletedVaultHashes", () => {
  it("lists tombstoned hashes that no live row shares", () => {
    const gone = deletedVaultHashes([
      { content_hash: "h1", deleted_at: "2026-10-11T00:00:00Z" },
      { content_hash: "h2", deleted_at: "2026-10-11T00:00:00Z" },
      { content_hash: "h2", deleted_at: null },
      { content_hash: null, deleted_at: "2026-10-11T00:00:00Z" },
    ]);
    expect(gone).toEqual(["h1"]);
  });
});
