import { beforeEach, describe, expect, it } from "vitest";
import {
  MemorySyncStorage,
  SIGN_IN_AGAIN,
  SyncAuthError,
  SyncEngine,
  SyncNetworkError,
  type PlayEventInsert,
  type PlaylistItemUpsert,
  type PlaylistUpsert,
  type QueueStateUpsert,
  type RemoteChanges,
  type SyncTransport,
  type TrackInsertMinimal,
} from "../src/sync";
import type {
  FavoriteRow,
  PlayEventRow,
  PlaylistItemRow,
  PlaylistRow,
  QueueStateRow,
  RatingRow,
  SettingRow,
  TrackRow,
} from "../src/supabase/database.types";
import { applyTrackEdit, type TrackEditPatch } from "../src/trackFields";

// ---- deterministic clock helpers ------------------------------------------

const BASE = Date.UTC(2026, 0, 1);
/** ts(n): a stable ISO timestamp n seconds after the epoch base. */
const ts = (n: number) => new Date(BASE + n * 1000).toISOString();

// ---- fake server + transport ----------------------------------------------
// One FakeServer, one FakeTransport per simulated device. The server assigns
// updated_at/created_at from a logical clock, mirroring the Postgres triggers.

class FakeServer {
  private clock = 0;
  tracks = new Map<string, TrackRow>();
  favorites = new Map<string, FavoriteRow>();
  ratings = new Map<string, RatingRow>();
  playlists = new Map<string, PlaylistRow>();
  items = new Map<string, PlaylistItemRow>();
  settings = new Map<string, SettingRow>();
  queue: QueueStateRow | null = null;
  playEvents = new Map<string, PlayEventRow>();
  private nextTrackId = 1;

  tick(): string {
    this.clock += 1;
    return new Date(BASE + 1_000_000_000 + this.clock * 1000).toISOString();
  }

  newTrackId(): string {
    return `track-${this.nextTrackId++}`;
  }

  itemsOf(playlistId: string): PlaylistItemRow[] {
    return [...this.items.values()].filter((i) => i.playlist_id === playlistId);
  }

  /** Live track ids of a playlist in fractional order — the merged truth. */
  order(playlistId: string): string[] {
    return this.itemsOf(playlistId)
      .filter((i) => !i.deleted_at)
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((i) => i.track_id);
  }
}

class FakeTransport implements SyncTransport {
  offline = false;
  /** When true, every call fails as an expired session would (PostgREST PGRST301). */
  sessionExpired = false;
  /** When set, favorite pushes fail with this non-network error (a rejected write). */
  favoriteError: string | null = null;
  onChangeCbs: Array<() => void> = [];

  constructor(private readonly server: FakeServer) {}

  private guard(): void {
    if (this.offline) throw new SyncNetworkError("fetch failed (offline)");
    if (this.sessionExpired) throw new SyncAuthError("JWT expired");
  }

  private pulled<T extends { [k: string]: unknown }>(rows: T[], column: string, since: string | null): T[] {
    return rows
      .filter((r) => since === null || (r[column] as string) > since)
      .sort((a, b) => (a[column] as string).localeCompare(b[column] as string));
  }

  async pullTracks(since: string | null) {
    this.guard();
    return this.pulled([...this.server.tracks.values()], "updated_at", since);
  }
  async pullPlaylists(since: string | null) {
    this.guard();
    return this.pulled([...this.server.playlists.values()], "updated_at", since);
  }
  async pullPlaylistItems(since: string | null) {
    this.guard();
    return this.pulled([...this.server.items.values()], "updated_at", since);
  }
  async pullFavorites(since: string | null) {
    this.guard();
    return this.pulled([...this.server.favorites.values()], "updated_at", since);
  }
  async pullRatings(since: string | null) {
    this.guard();
    return this.pulled([...this.server.ratings.values()], "updated_at", since);
  }
  async pullSettings(since: string | null) {
    this.guard();
    return this.pulled([...this.server.settings.values()], "updated_at", since);
  }
  async pullQueueState() {
    this.guard();
    return this.server.queue;
  }
  async pullPlayEvents(since: string | null) {
    this.guard();
    return this.pulled([...this.server.playEvents.values()], "created_at", since);
  }

  async getTrackByHash(contentHash: string) {
    this.guard();
    for (const row of this.server.tracks.values()) {
      if (row.content_hash === contentHash) return row;
    }
    return null;
  }

  async insertTrack(row: TrackInsertMinimal): Promise<TrackRow> {
    this.guard();
    const existing = await this.getTrackByHash(row.content_hash);
    if (existing) return existing;
    const track: TrackRow = {
      id: this.server.newTrackId(),
      user_id: "user-1",
      content_hash: row.content_hash,
      file_name: row.file_name,
      file_size: row.file_size,
      title: row.title,
      artist: row.artist,
      album: row.album,
      album_artist: null,
      genre: null,
      year: null,
      language: null,
      country: null,
      release_date: null,
      composer: null,
      track_no: null,
      disc_no: null,
      bpm: null,
      replaygain_track_db: null,
      replaygain_album_db: null,
      duration: row.duration,
      codec: null,
      sample_rate: null,
      bit_depth: null,
      channels: null,
      lyrics_text: null,
      lyrics_synced: null,
      storage_key: null,
      uploaded_at: null,
      artwork_key: null,
      field_edited_at: {},
      deleted_at: null,
      merged_into: null,
      created_at: this.server.tick(),
      updated_at: this.server.tick(),
    };
    this.server.tracks.set(track.id, track);
    return track;
  }

  applyEditCalls = 0;
  async applyTrackEdit(trackId: string, patch: TrackEditPatch, editedAt: string) {
    this.guard();
    this.applyEditCalls++;
    const row = this.server.tracks.get(trackId);
    if (!row || row.deleted_at) return null; // apply_track_edit raises P0002
    const next: TrackRow = { ...applyTrackEdit(row, patch, editedAt), updated_at: this.server.tick() };
    this.server.tracks.set(trackId, next);
    return next;
  }

  async getFavorite(trackId: string) {
    this.guard();
    return this.server.favorites.get(trackId) ?? null;
  }
  async upsertFavorite(row: { track_id: string; favorite: boolean; edited_at: string }) {
    this.guard();
    if (this.favoriteError) throw new Error(this.favoriteError);
    const prev = this.server.favorites.get(row.track_id);
    this.server.favorites.set(row.track_id, {
      user_id: "user-1",
      track_id: row.track_id,
      favorite: row.favorite,
      edited_at: row.edited_at,
      created_at: prev?.created_at ?? this.server.tick(),
      updated_at: this.server.tick(),
    });
  }

  async getRating(trackId: string) {
    this.guard();
    return this.server.ratings.get(trackId) ?? null;
  }
  async upsertRating(row: { track_id: string; rating: number; edited_at: string }) {
    this.guard();
    this.server.ratings.set(row.track_id, {
      user_id: "user-1",
      track_id: row.track_id,
      rating: row.rating,
      edited_at: row.edited_at,
      updated_at: this.server.tick(),
    });
  }

  async getPlaylist(id: string) {
    this.guard();
    return this.server.playlists.get(id) ?? null;
  }
  async upsertPlaylist(row: PlaylistUpsert) {
    this.guard();
    const prev = this.server.playlists.get(row.id);
    this.server.playlists.set(row.id, {
      id: row.id,
      user_id: "user-1",
      parent_id: row.parent_id,
      name: row.name,
      is_folder: row.is_folder,
      is_smart: row.is_smart,
      smart_rules: row.smart_rules as never,
      position: row.position,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      created_at: prev?.created_at ?? this.server.tick(),
      updated_at: this.server.tick(),
    });
  }

  async getPlaylistItems(playlistId: string) {
    this.guard();
    return this.server.itemsOf(playlistId);
  }
  async upsertPlaylistItem(row: PlaylistItemUpsert) {
    this.guard();
    const key = `${row.playlist_id}/${row.track_id}`;
    const prev = this.server.items.get(key);
    this.server.items.set(key, {
      id: prev?.id ?? key,
      user_id: "user-1",
      playlist_id: row.playlist_id,
      track_id: row.track_id,
      position: row.position,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      added_at: prev?.added_at ?? this.server.tick(),
      updated_at: this.server.tick(),
    });
  }

  async getSetting(scope: string, key: string) {
    this.guard();
    return this.server.settings.get(`${scope}/${key}`) ?? null;
  }
  async upsertSetting(row: { scope: string; key: string; value: unknown; edited_at: string }) {
    this.guard();
    this.server.settings.set(`${row.scope}/${row.key}`, {
      user_id: "user-1",
      scope: row.scope,
      key: row.key,
      value: row.value as never,
      edited_at: row.edited_at,
      updated_at: this.server.tick(),
    });
  }

  async upsertQueueState(row: QueueStateUpsert) {
    this.guard();
    this.server.queue = {
      user_id: "user-1",
      device_id: row.device_id,
      track_ids: row.track_ids,
      current_index: row.current_index,
      position_seconds: row.position_seconds,
      shuffle: row.shuffle,
      repeat: row.repeat as "off",
      edited_at: row.edited_at,
      updated_at: this.server.tick(),
    };
  }

  async insertPlayEvent(row: PlayEventInsert) {
    this.guard();
    if (this.server.playEvents.has(row.id)) return; // on conflict do nothing
    this.server.playEvents.set(row.id, {
      ...row,
      user_id: "user-1",
      created_at: this.server.tick(),
    });
  }

  subscribe(onChange: () => void): () => void {
    this.onChangeCbs.push(onChange);
    return () => {
      this.onChangeCbs = this.onChangeCbs.filter((cb) => cb !== onChange);
    };
  }
}

// ---- device harness ---------------------------------------------------------

interface Device {
  engine: SyncEngine;
  transport: FakeTransport;
  storage: MemorySyncStorage;
  changes: RemoteChanges[];
}

let opSeq = 0;

function makeDevice(server: FakeServer, name: string, refreshAuth?: () => Promise<void>): Device {
  const transport = new FakeTransport(server);
  const storage = new MemorySyncStorage();
  const changes: RemoteChanges[] = [];
  let clock = 0;
  const engine = new SyncEngine(transport, storage, {
    deviceId: name,
    now: () => ts(clock++),
    uuid: () => `${name}-op-${++opSeq}`,
    autoSync: false, // tests sequence cycles explicitly for determinism
    onChanges: (c) => changes.push(c),
    refreshAuth,
  });
  return { engine, transport, storage, changes };
}

/** All favorite changes seen by a device, flattened. */
const favoriteChanges = (d: Device) => d.changes.flatMap((c) => c.favorites);
const ratingChanges = (d: Device) => d.changes.flatMap((c) => c.ratings);

const HASH_REF = (n: number) => ({
  contentHash: `hash-${n}`,
  fileName: `Song ${n}.flac`,
  fileSize: 1000 + n,
  title: `Song ${n}`,
  artist: "Artist",
  album: "Album",
  duration: 180,
});

describe("SyncEngine", () => {
  let server: FakeServer;
  let a: Device;
  let b: Device;

  beforeEach(async () => {
    opSeq = 0;
    server = new FakeServer();
    a = makeDevice(server, "A");
    b = makeDevice(server, "B");
    await a.engine.init();
    await b.engine.init();
  });

  it("flushes a favorite and creates the canonical track row on demand", async () => {
    await a.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await a.engine.syncNow();

    expect(server.tracks.size).toBe(1);
    const track = [...server.tracks.values()][0];
    expect(track.content_hash).toBe("hash-1");
    expect(track.title).toBe("Song 1");
    expect(server.favorites.get(track.id)?.favorite).toBe(true);
    expect(await a.storage.outboxAll()).toHaveLength(0);
  });

  it("two devices favoriting the same unpublished track converge on one row", async () => {
    await a.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await b.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(11) });
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(server.tracks.size).toBe(1);
    expect(server.favorites.size).toBe(1);
  });

  it("replaying an already-pushed op is idempotent", async () => {
    const op = { kind: "favorite.set" as const, track: HASH_REF(1), favorite: true, editedAt: ts(10) };
    await a.engine.enqueue(op);
    await a.engine.syncNow();

    // Simulate a crash after the push but before the outbox delete: the same
    // envelope is still queued on restart and flushes again.
    await a.storage.outboxPut({ id: "A-op-crash", deviceId: "A", createdAt: ts(0), payload: op });
    await a.engine.syncNow();

    expect(server.tracks.size).toBe(1);
    expect(server.favorites.size).toBe(1);
    expect([...server.favorites.values()][0].favorite).toBe(true);
  });

  it("rating conflict: the later edit wins regardless of flush order", async () => {
    // B edits first in wall-clock time, A edits later; B flushes LAST.
    await a.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 3, editedAt: ts(20) });
    await b.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 5, editedAt: ts(15) });
    await a.engine.syncNow();
    await b.engine.syncNow();

    const track = [...server.tracks.values()][0];
    expect(server.ratings.get(track.id)?.rating).toBe(3);
    // B's losing op was dropped AND B was handed the winning value to apply.
    expect(ratingChanges(b).some((r) => r.rating === 3)).toBe(true);
    expect(await b.storage.outboxAll()).toHaveLength(0);
  });

  it("outbox coalesces repeated edits of the same entity", async () => {
    await a.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 1, editedAt: ts(10) });
    await a.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 2, editedAt: ts(11) });
    await a.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 4, editedAt: ts(12) });
    await a.engine.syncNow();
    const track = [...server.tracks.values()][0];
    expect(server.ratings.get(track.id)?.rating).toBe(4);
  });

  it("an empty queue.set clears the handoff row and reaches the other device", async () => {
    await a.engine.enqueue({
      kind: "queue.set",
      tracks: [HASH_REF(1), HASH_REF(2)],
      currentIndex: 1,
      positionSeconds: 12,
      shuffle: false,
      repeat: "off",
      editedAt: ts(10),
    });
    await a.engine.syncNow();
    expect(server.queue?.track_ids).toHaveLength(2);

    await b.engine.syncNow();
    expect(b.changes.at(-1)?.queue?.tracks).toHaveLength(2);

    // Clearing the queue is a real edit: it must land, not be swallowed.
    await a.engine.enqueue({
      kind: "queue.set",
      tracks: [],
      currentIndex: 0,
      positionSeconds: 0,
      shuffle: false,
      repeat: "off",
      editedAt: ts(20),
    });
    await a.engine.syncNow();
    expect(server.queue?.track_ids).toEqual([]);
    expect(server.queue?.current_index).toBe(0);

    await b.engine.syncNow();
    expect(b.changes.at(-1)?.queue?.tracks).toEqual([]);
  });

  it("offline: ops queue, survive, and flush on reconnect", async () => {
    a.transport.offline = true;
    await a.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await a.engine.syncNow();
    expect(a.engine.getStatus().phase).toBe("offline");
    expect(await a.storage.outboxAll()).toHaveLength(1);
    expect(server.favorites.size).toBe(0);

    a.transport.offline = false;
    a.engine.notifyOnline();
    await a.engine.syncNow();
    expect(a.engine.getStatus().phase).toBe("idle");
    expect(server.favorites.size).toBe(1);
    expect(await a.storage.outboxAll()).toHaveLength(0);
  });

  it("a restart that starts offline still knows when this device last synced", async () => {
    await a.engine.syncNow();
    const lastSyncAt = a.engine.getStatus().lastSyncAt;
    expect(lastSyncAt).not.toBeNull();

    // Same storage, new engine: the in-memory status starts empty.
    const transport = new FakeTransport(server);
    transport.offline = true;
    const restarted = new SyncEngine(transport, a.storage, { deviceId: "a", now: () => ts(999), uuid: () => "x", autoSync: false });
    await restarted.syncNow();
    expect(restarted.getStatus()).toMatchObject({ phase: "offline", lastSyncAt });
  });

  it("a rejected push keeps the status in error after a successful pull", async () => {
    a.transport.favoriteError = "constraint violated";
    await a.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: "error", pendingOps: 1, lastError: "constraint violated" });
    expect(a.engine.getStatus().lastSyncAt).not.toBeNull();

    a.transport.favoriteError = null;
    await a.engine.syncNow();
    expect(a.engine.getStatus()).toMatchObject({ phase: "idle", pendingOps: 0, lastError: null });
    expect(server.favorites.size).toBe(1);
  });

  it("an expired session is renewed once and the cycle retried", async () => {
    let renewals = 0;
    const d = makeDevice(server, "renewing", async () => {
      renewals++;
      d.transport.sessionExpired = false;
    });
    await d.engine.init();
    d.transport.sessionExpired = true;
    await d.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await d.engine.syncNow();
    expect(renewals).toBe(1);
    expect(d.engine.getStatus()).toMatchObject({ phase: "idle", pendingOps: 0, lastError: null });
    expect(server.favorites.size).toBe(1);
  });

  it("a session that can't be renewed asks to sign in again and keeps the change", async () => {
    const d = makeDevice(server, "stale", async () => {
      throw new Error("refresh token revoked");
    });
    await d.engine.init();
    d.transport.sessionExpired = true;
    await d.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ phase: "error", pendingOps: 1, lastError: SIGN_IN_AGAIN });
    // A refused session is not the change's fault: its retry count stays put.
    expect((await d.storage.outboxAll())[0].attempts).toBe(0);
  });

  it("breadcrumbs trace drops, cycles, coalescing, offline and lost conflicts", async () => {
    // Identity-less ref: dropped at enqueue.
    await a.engine.enqueue({
      kind: "favorite.set",
      track: { fileName: "no-identity.mp3" },
      favorite: true,
      editedAt: ts(5),
    });
    expect(a.engine.getBreadcrumbs()).toEqual([
      expect.objectContaining({ event: "enqueue.dropped", detail: { kind: "favorite.set" } }),
    ]);

    // Coalesced repeat edits + a successful cycle.
    await a.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 1, editedAt: ts(10) });
    await a.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 4, editedAt: ts(20) });
    await a.engine.syncNow();
    let events = a.engine.getBreadcrumbs().map((c) => c.event);
    expect(events).toContain("cycle.start");
    expect(events).toContain("flush.coalesced");
    expect(events.at(-1)).toBe("cycle.end");
    const end = a.engine.getBreadcrumbs().at(-1)!;
    expect(end.detail).toMatchObject({ phase: "idle", pendingOps: 0 });

    // Offline cycle ends with phase "offline" recorded.
    a.transport.offline = true;
    await a.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 2, editedAt: ts(30) });
    await a.engine.syncNow();
    expect(a.engine.getBreadcrumbs().at(-1)!.detail).toMatchObject({ phase: "offline" });
    a.transport.offline = false;

    // B's older concurrent edit loses LWW: conflictLost on B's trail.
    await b.engine.enqueue({ kind: "rating.set", track: HASH_REF(1), rating: 5, editedAt: ts(25) });
    await a.engine.syncNow(); // A lands rating 2 @ ts(30)
    await b.engine.syncNow(); // B's ts(25) edit loses
    events = b.engine.getBreadcrumbs().map((c) => c.event);
    expect(events).toContain("flush.conflictLost");
    expect(events).toContain("pull.applied");
  });

  it("pull applies the other device's favorite and advances the cursor", async () => {
    await a.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await a.engine.syncNow();

    await b.engine.syncNow();
    const seen = favoriteChanges(b);
    expect(seen).toHaveLength(1);
    expect(seen[0].favorite).toBe(true);
    expect(seen[0].track.contentHash).toBe("hash-1");

    // Nothing new: a second cycle emits no further changes.
    const countBefore = b.changes.length;
    await b.engine.syncNow();
    expect(b.changes.length).toBe(countBefore);
  });

  it("pull does not clobber a newer pending local edit", async () => {
    await a.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: true, editedAt: ts(10) });
    await a.engine.syncNow();
    await b.engine.syncNow(); // B now knows the track + favorite

    // B unfavorites while offline; A's older state must not overwrite it on pull.
    b.transport.offline = true;
    await b.engine.enqueue({ kind: "favorite.set", track: HASH_REF(1), favorite: false, editedAt: ts(30) });
    await b.engine.syncNow();
    b.transport.offline = false;

    const before = favoriteChanges(b).length;
    await b.engine.syncNow(true); // full pull included
    const applied = favoriteChanges(b).slice(before);
    expect(applied.every((f) => f.favorite === false)).toBe(true);

    const track = [...server.tracks.values()][0];
    expect(server.favorites.get(track.id)?.favorite).toBe(false);
  });

  it("playlist delete vs later rename: the rename resurrects the playlist", async () => {
    const playlist = {
      id: "pl-1",
      parentId: null,
      name: "Road Trip",
      isFolder: false,
      isSmart: false,
      smartRules: null,
      position: "a0",
    };
    await a.engine.enqueue({ kind: "playlist.upsert", playlist, editedAt: ts(10) });
    await a.engine.syncNow();
    await b.engine.syncNow();

    await a.engine.enqueue({ kind: "playlist.delete", playlistId: "pl-1", editedAt: ts(20) });
    await b.engine.enqueue({
      kind: "playlist.upsert",
      playlist: { ...playlist, name: "Road Trip 2026" },
      editedAt: ts(25),
    });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    const row = server.playlists.get("pl-1")!;
    expect(row.deleted_at).toBeNull();
    expect(row.name).toBe("Road Trip 2026");
    // A saw the resurrection via pull.
    const playlistChanges = a.changes.flatMap((c) => c.playlists);
    expect(playlistChanges.at(-1)?.name).toBe("Road Trip 2026");
    expect(playlistChanges.at(-1)?.deleted).toBe(false);
  });

  describe("playlist items", () => {
    const playlist = {
      id: "pl-1",
      parentId: null,
      name: "Mix",
      isFolder: false,
      isSmart: false,
      smartRules: null,
      position: "a0",
    };

    /** Seeds pl-1 with Song 1..3 from device A and syncs both devices. */
    async function seedPlaylist() {
      await a.engine.enqueue({ kind: "playlist.upsert", playlist, editedAt: ts(1) });
      for (let n = 1; n <= 3; n++) {
        await a.engine.enqueue({
          kind: "playlistItem.add",
          playlistId: "pl-1",
          track: HASH_REF(n),
          editedAt: ts(1 + n),
        });
      }
      await a.engine.syncNow();
      await b.engine.syncNow();
    }

    const idOf = (hash: string) => [...server.tracks.values()].find((t) => t.content_hash === hash)!.id;

    it("adds append in enqueue order", async () => {
      await seedPlaylist();
      expect(server.order("pl-1")).toEqual([idOf("hash-1"), idOf("hash-2"), idOf("hash-3")]);
    });

    it("concurrent reorder + add merge: both intents survive", async () => {
      await seedPlaylist();

      // A moves Song 3 to the front; B appends Song 4 after Song 3 — offline.
      a.transport.offline = true;
      b.transport.offline = true;
      await a.engine.enqueue({
        kind: "playlist.reorder",
        playlistId: "pl-1",
        tracks: [HASH_REF(3), HASH_REF(1), HASH_REF(2)],
        editedAt: ts(40),
      });
      await b.engine.enqueue({
        kind: "playlistItem.add",
        playlistId: "pl-1",
        track: HASH_REF(4),
        prevTrack: HASH_REF(3),
        editedAt: ts(41),
      });
      await a.engine.syncNow();
      await b.engine.syncNow();

      a.transport.offline = false;
      b.transport.offline = false;
      await a.engine.syncNow();
      await b.engine.syncNow();
      await a.engine.syncNow(); // A pulls B's addition

      // B's "after Song 3" anchor lands inside A's new order.
      expect(server.order("pl-1")).toEqual([
        idOf("hash-3"),
        idOf("hash-4"),
        idOf("hash-1"),
        idOf("hash-2"),
      ]);
      // Both devices converge on the merged order via their shadows.
      const aItems = await a.engine.orderedItems("pl-1");
      expect(aItems.tracks.map((t) => t.remoteId)).toEqual(server.order("pl-1"));
    });

    it("a remove never undoes a concurrent add", async () => {
      await seedPlaylist();
      a.transport.offline = true;
      b.transport.offline = true;
      await a.engine.enqueue({
        kind: "playlistItem.remove",
        playlistId: "pl-1",
        track: HASH_REF(2),
        editedAt: ts(40),
      });
      await b.engine.enqueue({
        kind: "playlistItem.add",
        playlistId: "pl-1",
        track: HASH_REF(4),
        editedAt: ts(41),
      });
      await a.engine.syncNow();
      await b.engine.syncNow();
      a.transport.offline = false;
      b.transport.offline = false;
      await a.engine.syncNow();
      await b.engine.syncNow();

      expect(server.order("pl-1")).toEqual([idOf("hash-1"), idOf("hash-3"), idOf("hash-4")]);
    });

    it("re-adding beats an older remove (LWW per item)", async () => {
      await seedPlaylist();
      await a.engine.enqueue({
        kind: "playlistItem.remove",
        playlistId: "pl-1",
        track: HASH_REF(2),
        editedAt: ts(40),
      });
      await b.engine.enqueue({
        kind: "playlistItem.add",
        playlistId: "pl-1",
        track: HASH_REF(2),
        editedAt: ts(45),
      });
      await b.engine.syncNow(); // newer add lands first
      await a.engine.syncNow(); // older remove must lose
      expect(server.order("pl-1")).toContain(idOf("hash-2"));
    });
  });

  it("settings sync per key with LWW", async () => {
    await a.engine.enqueue({ kind: "setting.set", scope: "global", key: "theme", value: "light", editedAt: ts(10) });
    await b.engine.enqueue({ kind: "setting.set", scope: "global", key: "theme", value: "dark", editedAt: ts(12) });
    await b.engine.enqueue({ kind: "setting.set", scope: "global", key: "accent", value: "blue", editedAt: ts(12) });
    await b.engine.syncNow();
    await a.engine.syncNow(); // A's older theme loses; accent untouched

    expect(server.settings.get("global/theme")?.value).toBe("dark");
    expect(server.settings.get("global/accent")?.value).toBe("blue");
    const applied = a.changes.flatMap((c) => c.settings);
    expect(applied.find((s) => s.key === "theme")?.value).toBe("dark");
  });

  it("queue handoff: LWW single row, identities mapped on pull", async () => {
    await a.engine.enqueue({
      kind: "queue.set",
      tracks: [HASH_REF(1), HASH_REF(2)],
      currentIndex: 1,
      positionSeconds: 42.5,
      shuffle: false,
      repeat: "all",
      editedAt: ts(10),
    });
    await a.engine.syncNow();

    await b.engine.syncNow();
    const queue = b.changes.map((c) => c.queue).find((q) => q !== null);
    expect(queue).toBeTruthy();
    expect(queue!.currentIndex).toBe(1);
    expect(queue!.positionSeconds).toBe(42.5);
    expect(queue!.repeat).toBe("all");
    expect(queue!.tracks.map((t) => t.contentHash)).toEqual(["hash-1", "hash-2"]);
    expect(queue!.deviceId).toBe("A");
  });

  it("play events are append-only and replay-idempotent", async () => {
    const event = {
      kind: "playEvent.add" as const,
      eventId: "evt-1",
      track: HASH_REF(1),
      playedAt: ts(10),
      durationPlayed: 175,
      completed: true,
    };
    await a.engine.enqueue(event);
    await a.engine.syncNow();
    // Crash-replay the same event id.
    await a.storage.outboxPut({ id: "A-op-replay", deviceId: "A", createdAt: ts(0), payload: event });
    await a.engine.syncNow();

    expect(server.playEvents.size).toBe(1);
    expect(server.playEvents.get("evt-1")?.completed).toBe(true);

    // B pulls the stream into its shadow.
    await b.engine.syncNow();
    expect(b.changes.some((c) => c.playEventsAdded === 1)).toBe(true);
  });

  it("distinct play events never coalesce", async () => {
    for (let i = 0; i < 3; i++) {
      await a.engine.enqueue({
        kind: "playEvent.add",
        eventId: `evt-${i}`,
        track: HASH_REF(1),
        playedAt: ts(10 + i),
        durationPlayed: 60,
        completed: false,
      });
    }
    await a.engine.syncNow();
    expect(server.playEvents.size).toBe(3);
  });

  it("drops ops whose track ref has no durable identity", async () => {
    await a.engine.enqueue({
      kind: "favorite.set",
      track: { fileName: "no-identity.mp3" },
      favorite: true,
      editedAt: ts(10),
    });
    await a.engine.syncNow();
    expect(server.tracks.size).toBe(0);
    expect(await a.storage.outboxAll()).toHaveLength(0);
  });
});

describe("SyncEngine — track.edit", () => {
  let server: FakeServer;
  let a: Device;
  let b: Device;

  const edit = (track: Record<string, unknown>, patch: TrackEditPatch, editedAt: string) =>
    ({ kind: "track.edit", track, patch, editedAt }) as const;

  /** Publishes HASH_REF(n) via a first edit on A and lets B see it. */
  async function publish(n: number): Promise<TrackRow> {
    await a.engine.enqueue(edit(HASH_REF(n), { genre: "Seed" }, ts(1)));
    await a.engine.syncNow();
    await b.engine.syncNow();
    return [...server.tracks.values()].find((t) => t.content_hash === `hash-${n}`)!;
  }

  const shadowTrack = async (d: Device, id: string) => {
    const raw = await d.storage.shadowGet("tracks", id);
    return raw ? (JSON.parse(raw) as TrackRow) : null;
  };

  beforeEach(async () => {
    opSeq = 0;
    server = new FakeServer();
    a = makeDevice(server, "A");
    b = makeDevice(server, "B");
    await a.engine.init();
    await b.engine.init();
  });

  it("flushes through apply_track_edit and reaches the other device", async () => {
    const track = await publish(1);
    await a.engine.enqueue(edit({ remoteId: track.id }, { title: "Renamed", language: "Bangla" }, ts(20)));
    await a.engine.syncNow();

    expect(server.tracks.get(track.id)?.title).toBe("Renamed");
    expect(await a.storage.outboxAll()).toHaveLength(0);
    expect((await shadowTrack(a, track.id))?.language).toBe("Bangla");

    b.changes.length = 0;
    await b.engine.syncNow();
    expect((await shadowTrack(b, track.id))?.title).toBe("Renamed");
    expect(b.changes.some((c) => c.tracksChanged)).toBe(true);
  });

  it("offline edits to different fields on two devices both survive", async () => {
    const track = await publish(1);
    await a.engine.enqueue(edit({ remoteId: track.id }, { title: "From A" }, ts(30)));
    await b.engine.enqueue(edit({ remoteId: track.id }, { genre: "From B" }, ts(20)));
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    const row = server.tracks.get(track.id)!;
    expect(row.title).toBe("From A");
    expect(row.genre).toBe("From B");
    expect((await shadowTrack(a, track.id))?.genre).toBe("From B");
    expect((await shadowTrack(b, track.id))?.title).toBe("From A");
  });

  it("the newer edit of a field wins whichever device flushes first", async () => {
    const track = await publish(1);
    await a.engine.enqueue(edit({ remoteId: track.id }, { title: "Newer" }, ts(30)));
    await b.engine.enqueue(edit({ remoteId: track.id }, { title: "Older" }, ts(20)));
    await a.engine.syncNow();
    await b.engine.syncNow(); // B's older edit loses; B converges on the server row

    expect(server.tracks.get(track.id)?.title).toBe("Newer");
    expect((await shadowTrack(b, track.id))?.title).toBe("Newer");
    expect(b.engine.getBreadcrumbs().some((c) => c.event === "flush.conflictLost" && c.detail?.fields === "title")).toBe(
      true,
    );
  });

  it("queued edits coalesce only when they touch the same fields", async () => {
    const track = await publish(1);
    a.transport.applyEditCalls = 0;
    await a.engine.enqueue(edit({ remoteId: track.id }, { title: "One" }, ts(10)));
    await a.engine.enqueue(edit({ remoteId: track.id }, { title: "Two" }, ts(11)));
    await a.engine.enqueue(edit({ remoteId: track.id }, { genre: "Rock" }, ts(12)));
    await a.engine.syncNow();

    expect(a.transport.applyEditCalls).toBe(2);
    expect(server.tracks.get(track.id)?.title).toBe("Two");
    expect(server.tracks.get(track.id)?.genre).toBe("Rock");
  });

  it("an edit to a track deleted elsewhere is dropped, not retried", async () => {
    const track = await publish(1);
    server.tracks.set(track.id, { ...server.tracks.get(track.id)!, deleted_at: ts(5), updated_at: server.tick() });
    await a.engine.enqueue(edit({ remoteId: track.id }, { title: "Too late" }, ts(20)));
    await a.engine.syncNow();

    expect(await a.storage.outboxAll()).toHaveLength(0);
    expect(server.tracks.get(track.id)?.title).toBe("Song 1");
  });

  it("never queues read-only, unknown or empty patches", async () => {
    await a.engine.enqueue(edit(HASH_REF(1), { duration: 1 } as TrackEditPatch, ts(10)));
    await a.engine.enqueue(edit(HASH_REF(1), {}, ts(11)));
    await a.engine.enqueue(edit(HASH_REF(1), { title: "  " }, ts(12)));
    expect(await a.storage.outboxAll()).toHaveLength(0);
    expect(a.engine.getBreadcrumbs().filter((c) => c.event === "enqueue.dropped")).toHaveLength(3);
  });

  it("ops queued against a merged duplicate land on the surviving row", async () => {
    const keep = await publish(1);
    const drop = await publish(2);
    // The server merged 2 into 1 (merge_tracks): 2 is now a tombstone.
    server.tracks.set(drop.id, {
      ...server.tracks.get(drop.id)!,
      content_hash: null,
      deleted_at: ts(40),
      merged_into: keep.id,
      updated_at: server.tick(),
    });
    await a.engine.syncNow(); // learns about the merge

    await a.engine.enqueue({ kind: "favorite.set", track: { remoteId: drop.id }, favorite: true, editedAt: ts(50) });
    await a.engine.enqueue(edit({ remoteId: drop.id }, { title: "Merged" }, ts(51)));
    await a.engine.syncNow();

    expect(server.favorites.get(keep.id)?.favorite).toBe(true);
    expect(server.favorites.has(drop.id)).toBe(false);
    expect(server.tracks.get(keep.id)?.title).toBe("Merged");
  });

  it("a full pull drops shadow rows the server no longer has; an incremental pull keeps them", async () => {
    const keep = await publish(1);
    const gone = await publish(2);
    server.tracks.delete(gone.id); // hard-deleted before tombstones existed

    await b.engine.syncNow();
    expect(await shadowTrack(b, gone.id)).not.toBeNull();

    b.changes.length = 0;
    await b.engine.syncNow(true);
    expect(await shadowTrack(b, gone.id)).toBeNull();
    expect(await shadowTrack(b, keep.id)).not.toBeNull();
    expect(b.changes.some((c) => c.tracksChanged)).toBe(true);

    // Its identity is forgotten too: a new op for that hash creates a fresh row.
    await b.engine.enqueue(edit(HASH_REF(2), { genre: "Again" }, ts(60)));
    await b.engine.syncNow();
    const again = [...server.tracks.values()].find((t) => t.content_hash === "hash-2");
    expect(again?.id).not.toBe(gone.id);
  });
});
