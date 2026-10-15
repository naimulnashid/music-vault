import type {
  FavoriteRow,
  PlaylistItemRow,
  PlaylistRow,
  QueueStateRow,
  RatingRow,
  SettingRow,
  TrackRow,
} from "../supabase/database.types";
import { isValidTrackPatch } from "../trackFields";
import type { RepeatMode } from "../types";
import { keyBetween, nKeysBetween } from "./fractional";
import type { OutboxEntry, SyncStorage } from "./storage";
import { SyncNetworkError, type SyncTransport } from "./transport";
import {
  opEditedAt,
  opEntityKey,
  trackRefHasIdentity,
  trackRefKeys,
  type RemoteChanges,
  type SyncBreadcrumb,
  type SyncOp,
  type SyncOpPayload,
  type SyncStatus,
  type TrackIdentity,
  type TrackRef,
} from "./types";

export interface SyncEngineOptions {
  /** This install's devices.id row (stamped on ops and play events). */
  deviceId: string | null;
  /** Clock/uuid injection points for deterministic tests. */
  now?: () => string;
  uuid?: () => string;
  /** When false, enqueue does not kick a sync cycle (tests drive syncNow). */
  autoSync?: boolean;
  /** Remote state applied by a pull (or lost LWW conflicts at flush). */
  onChanges?: (changes: RemoteChanges) => void;
  onStatus?: (status: SyncStatus) => void;
  /** Diagnostic trail (cycle outcomes, op failures, lost conflicts). */
  onBreadcrumb?: (crumb: SyncBreadcrumb) => void;
}

const REALTIME_DEBOUNCE_MS = 800;

function emptyChanges(): RemoteChanges {
  return {
    tracksChanged: false,
    favorites: [],
    ratings: [],
    playlists: [],
    playlistItems: [],
    settings: [],
    queue: null,
    playEventsAdded: 0,
  };
}

function defaultUuid(): string {
  return crypto.randomUUID();
}

/**
 * The MusicVault sync engine (docs/sync-protocol.md is the spec; the Kotlin
 * port must match this file's semantics 1:1).
 *
 * One instance per signed-in session. All server I/O goes through the
 * transport, all persistence through the storage — both injectable, so the
 * whole conflict surface is testable without a network.
 */
export class SyncEngine {
  private readonly now: () => string;
  private readonly uuid: () => string;

  /** Track identity maps rebuilt from the shadow at init and kept warm. */
  private trackById = new Map<string, TrackIdentity>();
  private trackByHash = new Map<string, string>();
  /** Merge tombstone id → the row that absorbed it (followed when resolving). */
  private mergedInto = new Map<string, string>();

  private status: SyncStatus = { phase: "idle", pendingOps: 0, lastSyncAt: null, lastError: null };
  private breadcrumbs: SyncBreadcrumb[] = [];
  private cycleRunning: Promise<void> | null = null;
  private cycleQueued: Promise<void> | null = null;
  private cycleQueuedFull = false;
  private realtimeUnsub: (() => void) | null = null;
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly transport: SyncTransport;
  private readonly storage: SyncStorage;
  private readonly opts: SyncEngineOptions;

  constructor(transport: SyncTransport, storage: SyncStorage, opts: SyncEngineOptions) {
    this.transport = transport;
    this.storage = storage;
    this.opts = opts;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.uuid = opts.uuid ?? defaultUuid;
  }

  /** Loads the track shadow into the identity maps. Call once before use. */
  async init(): Promise<void> {
    for (const { payload } of await this.storage.shadowAll("tracks")) {
      this.indexTrack(JSON.parse(payload) as TrackRow);
    }
    this.status = { ...this.status, pendingOps: (await this.storage.outboxAll()).length };
    this.emitStatus();
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Last N diagnostic breadcrumbs, oldest first (ring buffer, max 200). */
  getBreadcrumbs(): SyncBreadcrumb[] {
    return [...this.breadcrumbs];
  }

  private crumb(event: SyncBreadcrumb["event"], detail?: SyncBreadcrumb["detail"]): void {
    const crumb: SyncBreadcrumb = { at: this.now(), event, ...(detail ? { detail } : {}) };
    this.breadcrumbs.push(crumb);
    if (this.breadcrumbs.length > 200) this.breadcrumbs.shift();
    this.opts.onBreadcrumb?.(crumb);
  }

  /** Starts the Realtime subscription (pull-sooner hints). */
  start(): void {
    this.realtimeUnsub ??= this.transport.subscribe(() => this.schedulePull());
  }

  stop(): void {
    this.disposed = true;
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    this.realtimeUnsub?.();
    this.realtimeUnsub = null;
  }

  /** Queues a mutation and kicks a sync cycle. Refs without identity are dropped. */
  async enqueue(payload: SyncOpPayload): Promise<void> {
    if (!this.opPayloadSyncable(payload)) {
      this.crumb("enqueue.dropped", { kind: payload.kind });
      return;
    }
    const op: SyncOp = {
      id: this.uuid(),
      deviceId: this.opts.deviceId,
      createdAt: this.now(),
      payload,
    };
    await this.storage.outboxPut(op);
    this.status = { ...this.status, pendingOps: this.status.pendingOps + 1 };
    this.emitStatus();
    if (this.opts.autoSync !== false) void this.syncNow();
  }

  /**
   * Runs flush + pull. Cycles are serialized: calls during a running cycle
   * fold into a single follow-up cycle, and the returned promise resolves
   * only after that follow-up completes.
   */
  async syncNow(fullPull = false): Promise<void> {
    if (this.disposed) return;
    if (this.cycleRunning) {
      this.cycleQueuedFull ||= fullPull;
      this.cycleQueued ??= this.cycleRunning.then(() => {
        this.cycleQueued = null;
        const full = this.cycleQueuedFull;
        this.cycleQueuedFull = false;
        return this.disposed ? undefined : this.syncNow(full);
      });
      return this.cycleQueued;
    }
    this.cycleRunning = this.runCycle(fullPull).finally(() => {
      this.cycleRunning = null;
    });
    return this.cycleRunning;
  }

  /** Connectivity restored — retry whatever is queued. */
  notifyOnline(): void {
    void this.syncNow();
  }

  private schedulePull(): void {
    if (this.disposed) return;
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    else this.crumb("realtime.hint");
    this.realtimeTimer = setTimeout(() => {
      this.realtimeTimer = null;
      void this.syncNow();
    }, REALTIME_DEBOUNCE_MS);
  }

  private async runCycle(fullPull: boolean): Promise<void> {
    this.setPhase("syncing");
    this.crumb("cycle.start", { full: fullPull, pendingOps: this.status.pendingOps });
    const startedAt = Date.now();
    const changes = emptyChanges();
    try {
      await this.flush(changes);
      await this.pull(fullPull, changes);
      this.status = {
        phase: "idle",
        pendingOps: (await this.storage.outboxAll()).length,
        lastSyncAt: this.now(),
        lastError: null,
      };
    } catch (err) {
      const offline = err instanceof SyncNetworkError;
      this.status = {
        ...this.status,
        phase: offline ? "offline" : "error",
        pendingOps: (await this.storage.outboxAll()).length,
        lastError: err instanceof Error ? err.message : String(err),
      };
    }
    const applied =
      changes.favorites.length +
      changes.ratings.length +
      changes.playlists.length +
      changes.playlistItems.length +
      changes.settings.length +
      (changes.queue ? 1 : 0) +
      changes.playEventsAdded;
    if (applied > 0 || changes.tracksChanged) {
      this.crumb("pull.applied", {
        tracksChanged: changes.tracksChanged,
        favorites: changes.favorites.length,
        ratings: changes.ratings.length,
        playlists: changes.playlists.length,
        playlistItems: changes.playlistItems.length,
        settings: changes.settings.length,
        queue: changes.queue !== null,
        playEvents: changes.playEventsAdded,
      });
    }
    this.crumb("cycle.end", {
      phase: this.status.phase,
      pendingOps: this.status.pendingOps,
      ms: Date.now() - startedAt,
      ...(this.status.lastError ? { error: this.status.lastError } : {}),
    });
    this.emitStatus();
    this.emitChanges(changes);
  }

  // ---- flush ----------------------------------------------------------------

  private async flush(changes: RemoteChanges): Promise<void> {
    const entries = await this.storage.outboxAll();
    if (entries.length === 0) return;

    // Coalesce: one op per LWW entity (newest editedAt wins), play events all.
    const byEntity = new Map<string, OutboxEntry>();
    const stale: string[] = [];
    for (const entry of entries) {
      const key = opEntityKey(entry.op.payload);
      const prev = byEntity.get(key);
      if (!prev) {
        byEntity.set(key, entry);
      } else if (opEditedAt(entry.op.payload) >= opEditedAt(prev.op.payload)) {
        stale.push(prev.op.id);
        byEntity.set(key, entry);
      } else {
        stale.push(entry.op.id);
      }
    }
    if (stale.length > 0) {
      await this.storage.outboxDelete(stale);
      this.crumb("flush.coalesced", { dropped: stale.length, surviving: byEntity.size });
    }

    const survivors = [...byEntity.values()].sort(
      (a, b) => a.op.createdAt.localeCompare(b.op.createdAt) || a.op.id.localeCompare(b.op.id),
    );
    for (const entry of survivors) {
      try {
        await this.pushOp(entry.op, changes);
        await this.storage.outboxDelete([entry.op.id]);
      } catch (err) {
        if (err instanceof SyncNetworkError) throw err; // offline: stop, keep everything
        await this.storage.outboxBumpAttempts([entry.op.id]);
        // Non-network failure (constraint, bad payload): keep the op for a
        // later retry but let the rest of the queue through.
        const message = err instanceof Error ? err.message : String(err);
        this.crumb("flush.opFailed", {
          kind: entry.op.payload.kind,
          opId: entry.op.id,
          attempts: entry.attempts + 1,
          error: message,
        });
        this.status = { ...this.status, lastError: message };
      }
    }
  }

  /**
   * Pushes one op with a conditional (LWW) write. When the op loses the
   * conflict, the winning remote row is applied locally via `changes` so the
   * UI converges instead of keeping the stale local value.
   */
  private async pushOp(op: SyncOp, changes: RemoteChanges): Promise<void> {
    const p = op.payload;
    switch (p.kind) {
      case "favorite.set": {
        const trackId = await this.resolveTrackRef(p.track);
        if (!trackId) return;
        const remote = await this.transport.getFavorite(trackId);
        if (remote && remote.edited_at > p.editedAt) {
          this.crumb("flush.conflictLost", { kind: p.kind, entity: trackId });
          await this.applyFavoriteRow(remote, changes);
          return;
        }
        await this.transport.upsertFavorite({ track_id: trackId, favorite: p.favorite, edited_at: p.editedAt });
        await this.storage.shadowPut(
          "favorites",
          trackId,
          JSON.stringify({ track_id: trackId, favorite: p.favorite, edited_at: p.editedAt }),
        );
        return;
      }

      case "rating.set": {
        const trackId = await this.resolveTrackRef(p.track);
        if (!trackId) return;
        const remote = await this.transport.getRating(trackId);
        if (remote && remote.edited_at > p.editedAt) {
          this.crumb("flush.conflictLost", { kind: p.kind, entity: trackId });
          await this.applyRatingRow(remote, changes);
          return;
        }
        await this.transport.upsertRating({ track_id: trackId, rating: p.rating, edited_at: p.editedAt });
        await this.storage.shadowPut(
          "ratings",
          trackId,
          JSON.stringify({ track_id: trackId, rating: p.rating, edited_at: p.editedAt }),
        );
        return;
      }

      case "playlist.upsert": {
        const remote = await this.transport.getPlaylist(p.playlist.id);
        if (remote && remote.edited_at > p.editedAt) {
          this.crumb("flush.conflictLost", { kind: p.kind, entity: p.playlist.id });
          await this.applyPlaylistRow(remote, changes);
          return;
        }
        await this.transport.upsertPlaylist({
          id: p.playlist.id,
          parent_id: p.playlist.parentId,
          name: p.playlist.name,
          is_folder: p.playlist.isFolder,
          is_smart: p.playlist.isSmart,
          smart_rules: p.playlist.smartRules,
          position: p.playlist.position,
          edited_at: p.editedAt,
          deleted_at: null, // an upsert always revives (rename-after-delete resurrects)
        });
        return;
      }

      case "playlist.delete": {
        const remote = await this.transport.getPlaylist(p.playlistId);
        if (!remote) return; // never synced — nothing to tombstone
        if (remote.edited_at > p.editedAt) {
          this.crumb("flush.conflictLost", { kind: p.kind, entity: p.playlistId });
          await this.applyPlaylistRow(remote, changes);
          return;
        }
        await this.transport.upsertPlaylist({
          id: remote.id,
          parent_id: remote.parent_id,
          name: remote.name,
          is_folder: remote.is_folder,
          is_smart: remote.is_smart,
          smart_rules: remote.smart_rules,
          position: remote.position,
          edited_at: p.editedAt,
          deleted_at: p.editedAt,
        });
        return;
      }

      case "playlistItem.add": {
        const trackId = await this.resolveTrackRef(p.track);
        if (!trackId) return;
        if (!(await this.playlistExistsRemotely(p.playlistId))) return;
        const items = await this.transport.getPlaylistItems(p.playlistId);
        const existing = items.find((i) => i.track_id === trackId);
        if (existing && existing.edited_at >= p.editedAt) return; // newer state wins
        if (existing && !existing.deleted_at) {
          // Already live: touch edited_at in place so this add still beats an
          // older concurrent remove, without moving the item.
          await this.transport.upsertPlaylistItem({
            playlist_id: p.playlistId,
            track_id: trackId,
            position: existing.position,
            edited_at: p.editedAt,
            deleted_at: null,
          });
          await this.shadowPutItem(p.playlistId, trackId, existing.position, p.editedAt, null);
          return;
        }
        const position = await this.positionForAdd(p, items);
        await this.transport.upsertPlaylistItem({
          playlist_id: p.playlistId,
          track_id: trackId,
          position,
          edited_at: p.editedAt,
          deleted_at: null,
        });
        await this.shadowPutItem(p.playlistId, trackId, position, p.editedAt, null);
        return;
      }

      case "playlistItem.remove": {
        const trackId = await this.resolveTrackRef(p.track);
        if (!trackId) return;
        const items = await this.transport.getPlaylistItems(p.playlistId);
        const existing = items.find((i) => i.track_id === trackId);
        if (!existing || existing.deleted_at) return;
        if (existing.edited_at > p.editedAt) return; // re-added later elsewhere
        await this.transport.upsertPlaylistItem({
          playlist_id: p.playlistId,
          track_id: trackId,
          position: existing.position,
          edited_at: p.editedAt,
          deleted_at: p.editedAt,
        });
        await this.shadowPutItem(p.playlistId, trackId, existing.position, p.editedAt, p.editedAt);
        return;
      }

      case "playlist.reorder": {
        const items = await this.transport.getPlaylistItems(p.playlistId);
        const live = new Map(items.filter((i) => !i.deleted_at).map((i) => [i.track_id, i]));
        const desired: string[] = [];
        for (const ref of p.tracks) {
          const id = await this.resolveTrackRef(ref);
          if (id && live.has(id)) desired.push(id);
        }
        // Keep positions that already form an increasing subsequence of the
        // desired order (greedy); only out-of-place items get new keys, so
        // concurrent edits to untouched siblings survive.
        const kept: (string | null)[] = desired.map(() => null);
        let last = "";
        desired.forEach((trackId, i) => {
          const pos = live.get(trackId)!.position;
          if (last === "" || pos > last) {
            kept[i] = pos;
            last = pos;
          }
        });
        let i = 0;
        while (i < desired.length) {
          if (kept[i] !== null) {
            i++;
            continue;
          }
          let j = i;
          while (j < desired.length && kept[j] === null) j++;
          const prev = i > 0 ? kept[i - 1] : null;
          const next = j < desired.length ? kept[j] : null;
          const keys = nKeysBetween(prev, next, j - i);
          for (let k = i; k < j; k++) {
            kept[k] = keys[k - i];
            const item = live.get(desired[k])!;
            if (item.edited_at > p.editedAt) continue; // that item moved later elsewhere
            await this.transport.upsertPlaylistItem({
              playlist_id: p.playlistId,
              track_id: desired[k],
              position: keys[k - i],
              edited_at: p.editedAt,
              deleted_at: null,
            });
            await this.shadowPutItem(p.playlistId, desired[k], keys[k - i], p.editedAt, null);
          }
          i = j;
        }
        return;
      }

      case "setting.set": {
        const remote = await this.transport.getSetting(p.scope, p.key);
        if (remote && remote.edited_at > p.editedAt) {
          this.crumb("flush.conflictLost", { kind: p.kind, entity: `${p.scope}/${p.key}` });
          await this.applySettingRow(remote, changes);
          return;
        }
        await this.transport.upsertSetting({ scope: p.scope, key: p.key, value: p.value, edited_at: p.editedAt });
        await this.storage.shadowPut(
          "settings",
          `${p.scope}/${p.key}`,
          JSON.stringify({ scope: p.scope, key: p.key, value: p.value, edited_at: p.editedAt }),
        );
        return;
      }

      case "queue.set": {
        const remote = await this.transport.pullQueueState();
        if (remote && remote.edited_at > p.editedAt) {
          this.crumb("flush.conflictLost", { kind: p.kind, entity: "queue" });
          await this.applyQueueRow(remote, changes);
          return;
        }
        const trackIds: string[] = [];
        for (const ref of p.tracks) {
          const id = await this.resolveTrackRef(ref);
          if (id) trackIds.push(id);
        }
        await this.transport.upsertQueueState({
          device_id: op.deviceId,
          track_ids: trackIds,
          current_index: Math.min(p.currentIndex, Math.max(0, trackIds.length - 1)),
          position_seconds: p.positionSeconds,
          shuffle: p.shuffle,
          repeat: p.repeat,
          edited_at: p.editedAt,
        });
        return;
      }

      case "track.edit": {
        const trackId = await this.resolveTrackRef(p.track);
        if (!trackId) return;
        const row = await this.transport.applyTrackEdit(trackId, p.patch, p.editedAt);
        if (!row) {
          // Deleted elsewhere: the edit has nothing to apply to, so drop it.
          this.crumb("flush.opFailed", { kind: p.kind, opId: op.id, error: "track not found (dropped)" });
          return;
        }
        const at = Date.parse(p.editedAt);
        const lost = Object.keys(p.patch).filter((f) => Date.parse(row.field_edited_at?.[f] ?? "") > at);
        if (lost.length > 0) {
          this.crumb("flush.conflictLost", { kind: p.kind, entity: trackId, fields: lost.join(",") });
        }
        await this.cacheTrack(row);
        changes.tracksChanged = true;
        return;
      }

      case "playEvent.add": {
        const trackId = await this.resolveTrackRef(p.track);
        if (!trackId) return;
        await this.transport.insertPlayEvent({
          id: p.eventId,
          track_id: trackId,
          device_id: op.deviceId,
          played_at: p.playedAt,
          duration_played: p.durationPlayed,
          completed: p.completed,
        });
        return;
      }
    }
  }

  private async positionForAdd(
    p: Extract<SyncOpPayload, { kind: "playlistItem.add" }>,
    items: PlaylistItemRow[],
  ): Promise<string> {
    const live = items.filter((i) => !i.deleted_at).sort((a, b) => (a.position < b.position ? -1 : 1));
    const posOf = async (ref: TrackRef | undefined): Promise<string | null> => {
      if (!ref) return null;
      const id = await this.resolveTrackRef(ref);
      const item = id ? live.find((i) => i.track_id === id) : undefined;
      return item?.position ?? null;
    };
    const prev = await posOf(p.prevTrack);
    if (prev !== null) {
      const next = live.find((i) => i.position > prev)?.position ?? null;
      return keyBetween(prev, next);
    }
    const next = await posOf(p.nextTrack);
    if (next !== null) {
      const before = [...live].reverse().find((i) => i.position < next)?.position ?? null;
      return keyBetween(before, next);
    }
    // No usable anchors — append.
    const lastItem = live[live.length - 1];
    return keyBetween(lastItem?.position ?? null, null);
  }

  private async playlistExistsRemotely(playlistId: string): Promise<boolean> {
    const shadow = await this.storage.shadowGet("playlists", playlistId);
    if (shadow) {
      const row = JSON.parse(shadow) as PlaylistRow;
      if (!row.deleted_at) return true;
    }
    const remote = await this.transport.getPlaylist(playlistId);
    if (remote) await this.storage.shadowPut("playlists", playlistId, JSON.stringify(remote));
    return remote !== null && !remote.deleted_at;
  }

  private async shadowPutItem(
    playlistId: string,
    trackId: string,
    position: string,
    editedAt: string,
    deletedAt: string | null,
  ): Promise<void> {
    await this.storage.shadowPut(
      `playlist_items/${playlistId}`,
      trackId,
      JSON.stringify({ track_id: trackId, position, edited_at: editedAt, deleted_at: deletedAt }),
    );
  }

  // ---- track ref resolution ---------------------------------------------------

  private opPayloadSyncable(p: SyncOpPayload): boolean {
    switch (p.kind) {
      case "favorite.set":
      case "rating.set":
      case "playlistItem.add":
      case "playlistItem.remove":
      case "playEvent.add":
        return trackRefHasIdentity(p.track);
      case "track.edit":
        return trackRefHasIdentity(p.track) && isValidTrackPatch(p.patch as Record<string, unknown>);
      default:
        return true;
    }
  }

  /**
   * TrackRef → remote tracks.id. Uses the warm identity maps, then the
   * server, then creates a minimal canonical row. Returns null only for
   * identity-less refs (defensive — enqueue already rejects those).
   */
  private async resolveTrackRef(ref: TrackRef): Promise<string | null> {
    if (ref.remoteId) return this.canonical(ref.remoteId);
    if (!ref.contentHash) return null;
    const hit = this.trackByHash.get(ref.contentHash);
    if (hit) return this.canonical(hit);

    const remote = await this.transport.getTrackByHash(ref.contentHash);
    if (remote) {
      await this.cacheTrack(remote);
      return this.canonical(remote.id);
    }
    const stem = ref.fileName?.replace(/\.[^.]+$/, "");
    const created = await this.transport.insertTrack({
      content_hash: ref.contentHash,
      file_name: ref.fileName ?? ref.title ?? "unknown",
      file_size: ref.fileSize ?? 0,
      title: ref.title ?? stem ?? "Unknown",
      artist: ref.artist ?? "",
      album: ref.album ?? "",
      duration: ref.duration ?? 0,
    });
    await this.cacheTrack(created);
    return created.id;
  }

  private async cacheTrack(row: TrackRow): Promise<void> {
    await this.storage.shadowPut("tracks", row.id, JSON.stringify(row));
    this.indexTrack(row);
  }

  private indexTrack(row: TrackRow): void {
    this.trackById.set(row.id, { remoteId: row.id, contentHash: row.content_hash });
    if (row.content_hash) this.trackByHash.set(row.content_hash, row.id);
    if (row.merged_into) this.mergedInto.set(row.id, row.merged_into);
  }

  private unindexTrack(id: string): void {
    const ident = this.trackById.get(id);
    this.trackById.delete(id);
    this.mergedInto.delete(id);
    if (ident?.contentHash && this.trackByHash.get(ident.contentHash) === id) this.trackByHash.delete(ident.contentHash);
  }

  /**
   * Follows merge tombstones to the surviving row, so an op queued against a
   * duplicate lands on the track that absorbed its history.
   */
  private canonical(trackId: string): string {
    let id = trackId;
    for (let hops = 0; hops < 8 && this.mergedInto.has(id); hops++) id = this.mergedInto.get(id)!;
    return id;
  }

  private identity(trackId: string): TrackIdentity {
    return this.trackById.get(trackId) ?? { remoteId: trackId, contentHash: null };
  }

  // ---- pull -------------------------------------------------------------------

  private async pull(full: boolean, changes: RemoteChanges): Promise<void> {
    // Newest pending editedAt per entity key: local unflushed edits win locally.
    const pendingNewest = new Map<string, string>();
    for (const { op } of await this.storage.outboxAll()) {
      const editedAt = opEditedAt(op.payload);
      const keys = [opEntityKey(op.payload)];
      // Track-keyed ops can be known under several identities; index them all.
      const p = op.payload;
      if (p.kind === "favorite.set") keys.push(...trackRefKeys(p.track).map((k) => `favorite/${k}`));
      if (p.kind === "rating.set") keys.push(...trackRefKeys(p.track).map((k) => `rating/${k}`));
      if (p.kind === "playlistItem.add" || p.kind === "playlistItem.remove") {
        keys.push(...trackRefKeys(p.track).map((k) => `playlistItem/${p.playlistId}/${k}`));
      }
      for (const key of keys) {
        const prev = pendingNewest.get(key);
        if (!prev || editedAt > prev) pendingNewest.set(key, editedAt);
      }
    }
    const pendingWins = (keys: string[], rowEditedAt: string): boolean =>
      keys.some((key) => {
        const pending = pendingNewest.get(key);
        return pending !== undefined && pending >= rowEditedAt;
      });
    const keysFor = (prefix: string, trackId: string): string[] => {
      const ident = this.identity(trackId);
      return trackRefKeys({
        remoteId: trackId,
        contentHash: ident.contentHash ?? undefined,
      }).map((k) => `${prefix}/${k}`);
    };

    const cursorOf = async (name: string) => (full ? null : await this.storage.cursorGet(name));

    // tracks — first, so every later table can resolve track ids.
    {
      const rows = await this.transport.pullTracks(await cursorOf("tracks"));
      for (const row of rows) await this.cacheTrack(row);
      if (rows.length > 0) {
        changes.tracksChanged = true;
        await this.storage.cursorSet("tracks", rows[rows.length - 1].updated_at);
      }
      // A full pull is the whole table: drop shadow rows the server no longer
      // has (hard-deleted before tombstones existed), so the shadow is exact.
      if (full) {
        const live = new Set(rows.map((r) => r.id));
        for (const { id } of await this.storage.shadowAll("tracks")) {
          if (live.has(id)) continue;
          await this.storage.shadowDelete("tracks", id);
          this.unindexTrack(id);
          changes.tracksChanged = true;
        }
      }
    }

    // playlists
    {
      const rows = await this.transport.pullPlaylists(await cursorOf("playlists"));
      for (const row of rows) {
        if (!pendingWins([`playlist/${row.id}`], row.edited_at)) {
          await this.applyPlaylistRow(row, changes);
        }
      }
      if (rows.length > 0) await this.storage.cursorSet("playlists", rows[rows.length - 1].updated_at);
    }

    // playlist_items
    {
      const rows = await this.transport.pullPlaylistItems(await cursorOf("playlist_items"));
      const touched = new Set<string>();
      for (const row of rows) {
        const keys = [
          ...keysFor(`playlistItem/${row.playlist_id}`, row.track_id),
          `playlistReorder/${row.playlist_id}`,
        ];
        if (pendingWins(keys, row.edited_at)) continue;
        await this.shadowPutItem(row.playlist_id, row.track_id, row.position, row.edited_at, row.deleted_at);
        touched.add(row.playlist_id);
      }
      for (const playlistId of touched) {
        changes.playlistItems.push(await this.orderedItems(playlistId));
      }
      if (rows.length > 0) await this.storage.cursorSet("playlist_items", rows[rows.length - 1].updated_at);
    }

    // favorites
    {
      const rows = await this.transport.pullFavorites(await cursorOf("favorites"));
      for (const row of rows) {
        if (!pendingWins(keysFor("favorite", row.track_id), row.edited_at)) {
          await this.applyFavoriteRow(row, changes);
        }
      }
      if (rows.length > 0) await this.storage.cursorSet("favorites", rows[rows.length - 1].updated_at);
    }

    // ratings
    {
      const rows = await this.transport.pullRatings(await cursorOf("ratings"));
      for (const row of rows) {
        if (!pendingWins(keysFor("rating", row.track_id), row.edited_at)) {
          await this.applyRatingRow(row, changes);
        }
      }
      if (rows.length > 0) await this.storage.cursorSet("ratings", rows[rows.length - 1].updated_at);
    }

    // settings
    {
      const rows = await this.transport.pullSettings(await cursorOf("settings"));
      for (const row of rows) {
        if (!pendingWins([`setting/${row.scope}/${row.key}`], row.edited_at)) {
          await this.applySettingRow(row, changes);
        }
      }
      if (rows.length > 0) await this.storage.cursorSet("settings", rows[rows.length - 1].updated_at);
    }

    // queue_state — one row; emit only when it changed since last seen.
    {
      const row = await this.transport.pullQueueState();
      if (row) {
        const seen = await this.storage.shadowGet("queue", "singleton");
        const seenEditedAt = seen ? (JSON.parse(seen) as { edited_at: string }).edited_at : null;
        if (seenEditedAt !== row.edited_at && !pendingWins(["queue"], row.edited_at)) {
          await this.applyQueueRow(row, changes);
        }
      }
    }

    // play_events — append-only stream into the shadow (Phase 7 consumes it).
    {
      const rows = await this.transport.pullPlayEvents(await cursorOf("play_events"));
      for (const row of rows) {
        await this.storage.shadowPut("play_events", row.id, JSON.stringify(row));
      }
      changes.playEventsAdded += rows.length;
      if (rows.length > 0) await this.storage.cursorSet("play_events", rows[rows.length - 1].created_at);
    }
  }

  /** Live items of a playlist from the shadow, in fractional-position order. */
  async orderedItems(playlistId: string): Promise<{ playlistId: string; tracks: TrackIdentity[] }> {
    const rows = (await this.storage.shadowAll(`playlist_items/${playlistId}`)).map(
      ({ payload }) => JSON.parse(payload) as { track_id: string; position: string; deleted_at: string | null },
    );
    const tracks = rows
      .filter((r) => !r.deleted_at)
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.track_id.localeCompare(b.track_id)))
      .map((r) => this.identity(r.track_id));
    return { playlistId, tracks };
  }

  // ---- row application (shared by pull and lost-conflict paths) ----------------

  private async applyFavoriteRow(row: Pick<FavoriteRow, "track_id" | "favorite" | "edited_at">, changes: RemoteChanges): Promise<void> {
    await this.storage.shadowPut("favorites", row.track_id, JSON.stringify(row));
    changes.favorites.push({ track: this.identity(row.track_id), favorite: row.favorite, editedAt: row.edited_at });
  }

  private async applyRatingRow(row: Pick<RatingRow, "track_id" | "rating" | "edited_at">, changes: RemoteChanges): Promise<void> {
    await this.storage.shadowPut("ratings", row.track_id, JSON.stringify(row));
    changes.ratings.push({ track: this.identity(row.track_id), rating: row.rating, editedAt: row.edited_at });
  }

  private async applyPlaylistRow(row: PlaylistRow, changes: RemoteChanges): Promise<void> {
    await this.storage.shadowPut("playlists", row.id, JSON.stringify(row));
    changes.playlists.push({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      isFolder: row.is_folder,
      isSmart: row.is_smart,
      smartRules: row.smart_rules as never,
      position: row.position,
      deleted: row.deleted_at !== null,
      editedAt: row.edited_at,
    });
  }

  private async applySettingRow(row: SettingRow, changes: RemoteChanges): Promise<void> {
    await this.storage.shadowPut("settings", `${row.scope}/${row.key}`, JSON.stringify(row));
    changes.settings.push({ scope: row.scope, key: row.key, value: row.value as never, editedAt: row.edited_at });
  }

  private async applyQueueRow(row: QueueStateRow, changes: RemoteChanges): Promise<void> {
    await this.storage.shadowPut("queue", "singleton", JSON.stringify(row));
    changes.queue = {
      tracks: row.track_ids.map((id) => this.identity(id)),
      currentIndex: row.current_index,
      positionSeconds: row.position_seconds,
      shuffle: row.shuffle,
      repeat: row.repeat as RepeatMode,
      deviceId: row.device_id,
      editedAt: row.edited_at,
    };
  }

  // ---- misc ---------------------------------------------------------------------

  private setPhase(phase: SyncStatus["phase"]): void {
    this.status = { ...this.status, phase };
    this.emitStatus();
  }

  private emitStatus(): void {
    this.opts.onStatus?.(this.status);
  }

  private emitChanges(changes: RemoteChanges): void {
    const hasAny =
      changes.tracksChanged ||
      changes.favorites.length > 0 ||
      changes.ratings.length > 0 ||
      changes.playlists.length > 0 ||
      changes.playlistItems.length > 0 ||
      changes.settings.length > 0 ||
      changes.queue !== null ||
      changes.playEventsAdded > 0;
    if (hasAny) this.opts.onChanges?.(changes);
  }
}
