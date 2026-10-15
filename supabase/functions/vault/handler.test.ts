import { beforeEach, describe, expect, it } from "vitest";
import { type Caller, createHandler, type TrackRow, type VaultDeps } from "./handler.ts";
import { artKey, audioKey, MAX_ART_BYTES } from "./keys.ts";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const TRACK = "10000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const ART_SHA = "c".repeat(64);

interface Row extends TrackRow {
  user_id: string;
  storage_key: string | null;
  artwork_key: string | null;
  deleted: boolean;
}

/** A tiny in-memory stand-in for the tracks table, R2 and the SQL functions. */
class World {
  rows = new Map<string, Row>();
  objects = new Map<string, number>(); // key → size
  marked: { trackId: string; storageKey: string }[] = [];
  logged: string[] = [];

  addTrack(row: Partial<Row> & { id: string; user_id: string }) {
    this.rows.set(row.id, {
      content_hash: HASH,
      file_size: 100,
      storage_key: null,
      artwork_key: null,
      deleted: false,
      ...row,
    });
  }

  caller(userId: string): Caller {
    const own = () => [...this.rows.values()].filter((r) => r.user_id === userId);
    return {
      userId,
      db: {
        getTrack: async (id) => own().find((r) => r.id === id) ?? null,
        referencedStorageKeys: async (keys) =>
          new Set(own().filter((r) => !r.deleted && r.storage_key && keys.includes(r.storage_key)).map((r) => r.storage_key!)),
        referencedArtworkKeys: async (keys) =>
          new Set(own().filter((r) => !r.deleted && r.artwork_key && keys.includes(r.artwork_key)).map((r) => r.artwork_key!)),
        deleteTrack: async (id) => {
          const row = own().find((r) => r.id === id && !r.deleted);
          if (!row) return null;
          const result = {
            storageKey: row.storage_key,
            artworkKey: row.artwork_key,
            artworkStillUsed: own().some((r) => r.id !== id && !r.deleted && r.artwork_key === row.artwork_key),
          };
          Object.assign(row, { deleted: true, storage_key: null, artwork_key: null });
          return result;
        },
      },
    };
  }

  deps(userId: string | null): VaultDeps {
    return {
      authenticate: async () => (userId ? this.caller(userId) : null),
      admin: {
        markStored: async (trackId, storageKey) => {
          this.marked.push({ trackId, storageKey });
          Object.assign(this.rows.get(trackId)!, { storage_key: storageKey, deleted: false });
        },
      },
      store: {
        presign: async (method, key, ttl) => `https://r2.test/${key}?method=${method}&ttl=${ttl}`,
        size: async (key) => this.objects.get(key) ?? null,
        remove: async (key) => {
          this.objects.delete(key);
        },
      },
      log: (message) => this.logged.push(message),
    };
  }
}

let world: World;
beforeEach(() => {
  world = new World();
});

async function call(userId: string | null, body: unknown, method = "POST") {
  const handler = createHandler(world.deps(userId));
  const init: RequestInit = { method, headers: { Authorization: "Bearer test" } };
  if (method === "POST") init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await handler(new Request("https://fn.test/vault", init));
  const text = await res.text();
  return { status: res.status, body: text && text !== "ok" ? JSON.parse(text) : text, headers: res.headers };
}

describe("request handling", () => {
  it("answers CORS preflight without authentication", async () => {
    const res = await call(null, null, "OPTIONS");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("requires a signed-in caller", async () => {
    expect((await call(null, { action: "sign-get", keys: ["x"] })).status).toBe(401);
  });

  it("rejects non-POST, non-JSON and unknown actions", async () => {
    expect((await call(ALICE, null, "GET")).status).toBe(405);
    expect((await call(ALICE, "not json")).body.error).toBe("bad_request");
    expect((await call(ALICE, [1, 2])).body.error).toBe("bad_request");
    expect((await call(ALICE, { action: "nope" })).body.error).toBe("unknown_action");
  });

  it("hides internal errors behind a generic 500", async () => {
    const deps = world.deps(ALICE);
    deps.store.presign = async () => {
      throw new Error("R2 down");
    };
    world.addTrack({ id: TRACK, user_id: ALICE });
    const res = await createHandler(deps)(
      new Request("https://fn.test", { method: "POST", body: JSON.stringify({ action: "sign-put", kind: "audio", trackId: TRACK, ext: "flac" }) }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal", message: "Vault request failed" });
    expect(world.logged).toEqual(["vault request failed"]);
  });
});

describe("sign-get", () => {
  const aliceAudio = audioKey(ALICE, HASH, "flac");
  const aliceArt = artKey(ALICE, ART_SHA, "full");

  beforeEach(() => {
    world.addTrack({ id: TRACK, user_id: ALICE, storage_key: aliceAudio, artwork_key: aliceArt });
  });

  it("signs the caller's referenced audio and covers, including the derived thumbnail", async () => {
    const thumb = artKey(ALICE, ART_SHA, "thumb");
    const res = await call(ALICE, { action: "sign-get", keys: [aliceAudio, aliceArt, thumb] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.urls).sort()).toEqual([aliceAudio, aliceArt, thumb].sort());
    expect(res.body.urls[aliceAudio]).toContain("method=GET");
    expect(res.body.denied).toEqual([]);
  });

  it("denies keys under another user's prefix, even if they exist", async () => {
    world.addTrack({ id: "10000000-0000-4000-8000-000000000002", user_id: BOB, storage_key: audioKey(BOB, HASH, "flac") });
    const res = await call(ALICE, { action: "sign-get", keys: [audioKey(BOB, HASH, "flac")] });
    expect(res.body.urls).toEqual({});
    expect(res.body.denied).toEqual([audioKey(BOB, HASH, "flac")]);
  });

  it("denies own-prefix keys that no live track references", async () => {
    const stray = audioKey(ALICE, "b".repeat(64), "mp3");
    const deletedCover = artKey(ALICE, "d".repeat(64), "full");
    const res = await call(ALICE, { action: "sign-get", keys: [stray, deletedCover, "../../etc/passwd", 42] });
    expect(res.body.urls).toEqual({});
    expect(res.body.denied.sort()).toEqual([stray, deletedCover, "../../etc/passwd", "42"].sort());
  });

  it("denies a deleted track's audio", async () => {
    world.rows.get(TRACK)!.deleted = true;
    const res = await call(ALICE, { action: "sign-get", keys: [aliceAudio] });
    expect(res.body.denied).toEqual([aliceAudio]);
  });

  it("validates the key list", async () => {
    expect((await call(ALICE, { action: "sign-get", keys: [] })).status).toBe(400);
    expect((await call(ALICE, { action: "sign-get", keys: "x" })).status).toBe(400);
    expect((await call(ALICE, { action: "sign-get", keys: Array(201).fill(aliceAudio) })).status).toBe(400);
  });
});

describe("sign-put", () => {
  beforeEach(() => {
    world.addTrack({ id: TRACK, user_id: ALICE });
  });

  it("signs an upload to the key derived from the track's own hash", async () => {
    const res = await call(ALICE, { action: "sign-put", kind: "audio", trackId: TRACK, ext: "flac" });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe(audioKey(ALICE, HASH, "flac"));
    expect(res.body.url).toContain("method=PUT");
  });

  it("refuses another user's track and unsupported extensions", async () => {
    expect((await call(BOB, { action: "sign-put", kind: "audio", trackId: TRACK, ext: "flac" })).status).toBe(404);
    expect((await call(ALICE, { action: "sign-put", kind: "audio", trackId: TRACK, ext: "exe" })).status).toBe(400);
    expect((await call(ALICE, { action: "sign-put", kind: "audio", trackId: "nope", ext: "flac" })).status).toBe(400);
  });

  it("refuses a track without a content hash", async () => {
    world.rows.get(TRACK)!.content_hash = null;
    expect((await call(ALICE, { action: "sign-put", kind: "audio", trackId: TRACK, ext: "flac" })).body.error).toBe("no_hash");
  });

  it("allows re-uploading a deleted track (revival)", async () => {
    world.rows.get(TRACK)!.deleted = true;
    expect((await call(ALICE, { action: "sign-put", kind: "audio", trackId: TRACK, ext: "flac" })).status).toBe(200);
  });

  it("signs cover uploads under the caller's art prefix", async () => {
    const full = await call(ALICE, { action: "sign-put", kind: "art", sha256: ART_SHA, variant: "full", size: 1000 });
    const thumb = await call(ALICE, { action: "sign-put", kind: "art", sha256: ART_SHA, variant: "thumb", size: 100 });
    expect(full.body.key).toBe(artKey(ALICE, ART_SHA, "full"));
    expect(thumb.body.key).toBe(artKey(ALICE, ART_SHA, "thumb"));
  });

  it("validates cover uploads", async () => {
    const base = { action: "sign-put", kind: "art", sha256: ART_SHA, variant: "full", size: 10 };
    expect((await call(ALICE, { ...base, sha256: "XYZ" })).status).toBe(400);
    expect((await call(ALICE, { ...base, variant: "huge" })).status).toBe(400);
    expect((await call(ALICE, { ...base, size: 0 })).status).toBe(400);
    expect((await call(ALICE, { ...base, size: MAX_ART_BYTES + 1 })).status).toBe(413);
    expect((await call(ALICE, { ...base, kind: "video" })).status).toBe(400);
  });
});

describe("commit", () => {
  const key = audioKey(ALICE, HASH, "flac");

  beforeEach(() => {
    world.addTrack({ id: TRACK, user_id: ALICE, file_size: 100 });
  });

  it("records a confirmed upload", async () => {
    world.objects.set(key, 100);
    const res = await call(ALICE, { action: "commit", trackId: TRACK, ext: "flac" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trackId: TRACK, storageKey: key, size: 100 });
    expect(world.marked).toEqual([{ trackId: TRACK, storageKey: key }]);
  });

  it("refuses when nothing was uploaded", async () => {
    const res = await call(ALICE, { action: "commit", trackId: TRACK, ext: "flac" });
    expect(res.body.error).toBe("not_uploaded");
    expect(world.marked).toEqual([]);
  });

  it("deletes a wrong-sized upload instead of recording it", async () => {
    world.objects.set(key, 42);
    const res = await call(ALICE, { action: "commit", trackId: TRACK, ext: "flac" });
    expect(res.body.error).toBe("size_mismatch");
    expect(world.objects.has(key)).toBe(false);
    expect(world.marked).toEqual([]);
  });

  it("refuses another user's track", async () => {
    world.objects.set(key, 100);
    expect((await call(BOB, { action: "commit", trackId: TRACK, ext: "flac" })).status).toBe(404);
    expect(world.marked).toEqual([]);
  });
});

describe("delete", () => {
  const audio = audioKey(ALICE, HASH, "flac");
  const cover = artKey(ALICE, ART_SHA, "full");
  const thumb = artKey(ALICE, ART_SHA, "thumb");

  beforeEach(() => {
    world.addTrack({ id: TRACK, user_id: ALICE, storage_key: audio, artwork_key: cover });
    for (const k of [audio, cover, thumb]) world.objects.set(k, 1);
  });

  it("removes the audio and an unshared cover", async () => {
    const res = await call(ALICE, { action: "delete", trackId: TRACK });
    expect(res.body).toEqual({ trackId: TRACK, deleted: true });
    expect([...world.objects.keys()]).toEqual([]);
  });

  it("keeps a cover another track still uses", async () => {
    world.addTrack({ id: "10000000-0000-4000-8000-000000000002", user_id: ALICE, artwork_key: cover });
    await call(ALICE, { action: "delete", trackId: TRACK });
    expect([...world.objects.keys()].sort()).toEqual([cover, thumb].sort());
  });

  it("refuses another user's track and missing tracks", async () => {
    expect((await call(BOB, { action: "delete", trackId: TRACK })).status).toBe(404);
    expect(world.objects.has(audio)).toBe(true);
    expect((await call(ALICE, { action: "delete", trackId: "10000000-0000-4000-8000-00000000ffff" })).status).toBe(404);
  });

  it("still succeeds when R2 cleanup fails, and logs it", async () => {
    const deps = world.deps(ALICE);
    deps.store.remove = async () => {
      throw new Error("R2 down");
    };
    const res = await createHandler(deps)(
      new Request("https://fn.test", { method: "POST", body: JSON.stringify({ action: "delete", trackId: TRACK }) }),
    );
    expect(res.status).toBe(200);
    expect(world.logged.length).toBe(3);
  });
});
