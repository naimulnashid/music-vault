import type { TrackEditPatch } from "../trackFields";
import type { RepeatMode } from "../types";

/** JSON-compatible value (settings values, smart rules, payload storage). */
export type SyncJson = string | number | boolean | null | { [key: string]: SyncJson } | SyncJson[];

/**
 * A reference to a track that may or may not exist in the remote `tracks`
 * table yet. Ops carry every identity the client knows plus enough metadata
 * to create a minimal canonical row at flush time. A ref with neither
 * `remoteId` nor `contentHash` is unsyncable (the remote schema requires a
 * hash identity) and must not be enqueued.
 */
export interface TrackRef {
  remoteId?: string;
  contentHash?: string;
  fileName?: string;
  fileSize?: number;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
}

export function trackRefHasIdentity(ref: TrackRef): boolean {
  return Boolean(ref.remoteId || ref.contentHash);
}

/**
 * Stable key for "the same track" across ops, used for outbox coalescing and
 * pending-op conflict checks. Prefers durable identities over the remote id
 * so an op enqueued before the remote row existed still matches one after.
 */
export function trackRefKey(ref: TrackRef): string {
  if (ref.contentHash) return `hash:${ref.contentHash}`;
  return `remote:${ref.remoteId ?? ""}`;
}

/**
 * Every key under which a ref (or a remote row's identities) can be known —
 * pending-op lookups match on any of them, so an op that only knew a content
 * hash still matches the remote row it now has an id for.
 */
export function trackRefKeys(ref: TrackRef): string[] {
  const keys: string[] = [];
  if (ref.contentHash) keys.push(`hash:${ref.contentHash}`);
  if (ref.remoteId) keys.push(`remote:${ref.remoteId}`);
  return keys;
}

export interface PlaylistSnapshot {
  id: string;
  parentId: string | null;
  name: string;
  isFolder: boolean;
  isSmart: boolean;
  /** JSON-serialized SmartRules AST, or null. */
  smartRules: SyncJson | null;
  position: string;
}

export type SyncOpPayload =
  | { kind: "favorite.set"; track: TrackRef; favorite: boolean; editedAt: string }
  | { kind: "rating.set"; track: TrackRef; rating: number; editedAt: string }
  | { kind: "playlist.upsert"; playlist: PlaylistSnapshot; editedAt: string }
  | { kind: "playlist.delete"; playlistId: string; editedAt: string }
  | {
      kind: "playlistItem.add";
      playlistId: string;
      track: TrackRef;
      /** Order anchors captured at enqueue time; absent anchors mean append. */
      prevTrack?: TrackRef;
      nextTrack?: TrackRef;
      editedAt: string;
    }
  | { kind: "playlistItem.remove"; playlistId: string; track: TrackRef; editedAt: string }
  | { kind: "playlist.reorder"; playlistId: string; tracks: TrackRef[]; editedAt: string }
  | { kind: "setting.set"; scope: string; key: string; value: SyncJson; editedAt: string }
  | {
      kind: "queue.set";
      tracks: TrackRef[];
      currentIndex: number;
      positionSeconds: number;
      shuffle: boolean;
      repeat: RepeatMode;
      editedAt: string;
    }
  | {
      /**
       * Field-level LWW metadata edit (flushes through apply_track_edit). Only
       * the fields present in `patch` are written, each only if this edit is
       * at least as new as that field's last edit on the server.
       */
      kind: "track.edit";
      track: TrackRef;
      patch: TrackEditPatch;
      editedAt: string;
    }
  | {
      kind: "playEvent.add";
      eventId: string;
      track: TrackRef;
      playedAt: string;
      durationPlayed: number;
      completed: boolean;
    };

export type SyncOpKind = SyncOpPayload["kind"];

/** The persisted outbox envelope. `id` is the idempotency key. */
export interface SyncOp {
  id: string;
  deviceId: string | null;
  createdAt: string;
  payload: SyncOpPayload;
}

/**
 * Coalescing/conflict identity: ops with the same entity key target the same
 * LWW row, so only the newest needs to be flushed. Play events return a
 * per-op key — they are append-only and never coalesce.
 */
export function opEntityKey(payload: SyncOpPayload): string {
  switch (payload.kind) {
    case "favorite.set":
      return `favorite/${trackRefKey(payload.track)}`;
    case "rating.set":
      return `rating/${trackRefKey(payload.track)}`;
    case "playlist.upsert":
      return `playlist/${payload.playlist.id}`;
    case "playlist.delete":
      return `playlist/${payload.playlistId}`;
    case "playlistItem.add":
    case "playlistItem.remove":
      return `playlistItem/${payload.playlistId}/${trackRefKey(payload.track)}`;
    case "playlist.reorder":
      return `playlistReorder/${payload.playlistId}`;
    case "setting.set":
      return `setting/${payload.scope}/${payload.key}`;
    case "queue.set":
      return "queue";
    case "track.edit":
      // Edits only supersede each other when they touch the same fields;
      // edits to different fields must all reach the server.
      return `trackEdit/${trackRefKey(payload.track)}/${Object.keys(payload.patch).sort().join(",")}`;
    case "playEvent.add":
      return `playEvent/${payload.eventId}`;
  }
}

/** The LWW timestamp of an op (play events use their playedAt). */
export function opEditedAt(payload: SyncOpPayload): string {
  return payload.kind === "playEvent.add" ? payload.playedAt : payload.editedAt;
}

// ---- Remote state as surfaced to the app after a pull -----------------------

/** The identities of a remote track row, for mapping to client-local tracks. */
export interface TrackIdentity {
  remoteId: string;
  contentHash: string | null;
}

export interface FavoriteChange {
  track: TrackIdentity;
  favorite: boolean;
  editedAt: string;
}

export interface RatingChange {
  track: TrackIdentity;
  rating: number;
  editedAt: string;
}

export interface PlaylistChange extends PlaylistSnapshot {
  deleted: boolean;
  editedAt: string;
}

export interface PlaylistItemsChange {
  playlistId: string;
  /** Live items in list order (deleted items excluded). */
  tracks: TrackIdentity[];
}

export interface SettingChange {
  scope: string;
  key: string;
  value: SyncJson;
  editedAt: string;
}

export interface QueueChange {
  tracks: TrackIdentity[];
  currentIndex: number;
  positionSeconds: number;
  shuffle: boolean;
  repeat: RepeatMode;
  deviceId: string | null;
  editedAt: string;
}

/** Everything a pull applied, batched for the app to project into its stores. */
export interface RemoteChanges {
  tracksChanged: boolean;
  favorites: FavoriteChange[];
  ratings: RatingChange[];
  playlists: PlaylistChange[];
  playlistItems: PlaylistItemsChange[];
  settings: SettingChange[];
  queue: QueueChange | null;
  playEventsAdded: number;
}

export type SyncPhase = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  pendingOps: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

/**
 * A diagnostic trail entry. Breadcrumbs are observability only — they carry
 * no sync semantics, and the Kotlin port mirrors the emit points loosely
 * (same events, not byte-identical detail).
 */
export interface SyncBreadcrumb {
  at: string;
  event:
    | "cycle.start"
    | "cycle.end"
    | "flush.coalesced"
    | "flush.opFailed"
    | "flush.conflictLost"
    | "pull.applied"
    | "enqueue.dropped"
    | "realtime.hint";
  detail?: Record<string, string | number | boolean | null>;
}
