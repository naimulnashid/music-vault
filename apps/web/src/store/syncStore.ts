import { create } from "zustand";
import {
  SupabaseTransport,
  SyncEngine,
  handoffWins,
  type PlaylistRow,
  type QueueChange,
  type RemoteChanges,
  type Session,
  type SmartRules,
  type SyncOpPayload,
  type SyncStatus,
  type TrackIdentity,
  type TrackRef,
  type TrackRow,
} from "@musicvault/core";
import { getSupabaseBrowser } from "../lib/supabase/browser";
import { IdbSyncStorage } from "../lib/syncStorage";
import { pendingTrackEdits, projectRows } from "../lib/trackMap";
import { removeAudio } from "../lib/audioCache";
import { nowIso, refFromTrack, setSyncEnqueue } from "../lib/syncBus";
import { loadLastPlayback } from "../lib/lastPlayback";
import type { Playlist, Track } from "../types";
import { useAuthStore } from "./authStore";
import { useLibraryStore } from "./libraryStore";
import { useSettingsStore } from "./settingsStore";
import { usePlayerStore } from "./playerStore";
import { refreshStatsIfLoaded, resetStats } from "./statsStore";
import { useArtistPhotoStore } from "./artistPhotoStore";
import { useCollectionCoverStore } from "./collectionCoverStore";
import { useDownloadStore } from "./downloadStore";
import { forgetSignedUrls } from "../lib/vault";

/** Debounce for pushing queue changes (they arrive in bursts while skipping). */
const QUEUE_PUSH_MS = 3000;

interface SyncStoreState {
  status: SyncStatus | null;
  /** The last queue another device pushed (surfaced for handoff). */
  remoteQueue: QueueChange | null;
  syncNow: () => Promise<void>;
}

let engine: SyncEngine | null = null;
let storage: IdbSyncStorage | null = null;
let engineKey: string | null = null;
let queuePushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribePlayer: (() => void) | null = null;
let onlineListener: (() => void) | null = null;

export const useSyncStore = create<SyncStoreState>(() => ({
  status: null,
  remoteQueue: null,
  syncNow: async () => {
    await engine?.syncNow();
  },
}));

// ---- lifecycle -----------------------------------------------------------------

/** Cursor naming the account the stored outbox, cursors and shadow belong to. */
const OWNER_CURSOR = "account.owner";

/**
 * Stored sync state belongs to one account. A lost session keeps it for that
 * account; a different account signing in starts clean.
 */
async function claimStorage(s: IdbSyncStorage, userId: string): Promise<void> {
  const owner = await s.cursorGet(OWNER_CURSOR);
  if (owner && owner !== userId) await s.clearAll();
  await s.cursorSet(OWNER_CURSOR, userId);
}

function startEngine(session: Session, deviceId: string | null): void {
  const supabase = getSupabaseBrowser();
  if (!supabase) return;
  const key = `${session.user.id}/${deviceId ?? ""}`;
  if (engineKey === key) return; // already running for this identity
  stopEngine();
  engineKey = key;

  storage = new IdbSyncStorage();
  engine = new SyncEngine(new SupabaseTransport(supabase, session.user.id), storage, {
    deviceId,
    onChanges: (changes) => void applyChanges(changes),
    onStatus: (status) => useSyncStore.setState({ status }),
    // An expired token is renewed once per cycle; failing that the status asks to sign in again.
    refreshAuth: async () => {
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;
    },
    // No file log in the browser — the console trail (plus engine.getBreadcrumbs())
    // is the diagnostic surface here.
    onBreadcrumb: (crumb) => console.debug(`[sync] ${crumb.event}`, crumb.detail ?? ""),
  });

  setSyncEnqueue((payload) => void engine?.enqueue(payload), session.user.id);

  onlineListener = () => engine?.notifyOnline();
  window.addEventListener("online", onlineListener);

  unsubscribePlayer = usePlayerStore.subscribe((state, prev) => {
    // A restore (startup or handoff) isn't this device's edit: pushing it would make a
    // stale queue look like the newest one to other devices.
    if (state.queue !== prev.queue && state.queue === state.restoredQueue) return;
    // Compared by song ids: filling in a local path or resolver state rebuilds the array
    // without changing the queue.
    if ((state.queue !== prev.queue || state.currentIndex !== prev.currentIndex) && queueKey(state) !== queueKey(prev)) {
      scheduleQueuePush();
    } else if (prev.isPlaying && !state.isPlaying) {
      // Pause: push promptly so another device can pick up right here.
      scheduleQueuePush(500);
    }
  });

  const claimed = storage;
  void (async () => {
    try {
      await claimStorage(claimed, session.user.id);
      await engine!.init();
      await hydrateFromShadow();
      engine!.start();
      await engine!.syncNow(true); // startup full pull heals any cursor gap
      await maybeRestoreQueue();
    } catch (err) {
      console.error("[sync] startup failed:", err);
    }
  })();
}

function stopEngine(): void {
  setSyncEnqueue(null);
  if (queuePushTimer) clearTimeout(queuePushTimer);
  queuePushTimer = null;
  unsubscribePlayer?.();
  unsubscribePlayer = null;
  if (onlineListener) window.removeEventListener("online", onlineListener);
  onlineListener = null;
  // A push scheduled for this engine must not fire into the next one.
  if (queuePushTimer) clearTimeout(queuePushTimer);
  queuePushTimer = null;
  engine?.stop();
  engine = null;
  storage = null;
  engineKey = null;
  useSyncStore.setState({ status: null, remoteQueue: null });
}

/**
 * The next account must not inherit this one's playback or loaded data: stop
 * playback, drop the queue and resume point, signed links, queued downloads
 * and synced stats. Device-owned data stays: local listening history,
 * downloaded and cached audio files, and settings such as the theme. Call
 * after stopEngine, so the player listener is gone and the empty queue is not
 * pushed.
 */
function clearAccountPlayback(): void {
  usePlayerStore.getState().clearQueue();
  forgetSignedUrls();
  const { queued, cancelDownloads } = useDownloadStore.getState();
  if (queued.size > 0) void cancelDownloads([...queued]);
  resetStats();
  useArtistPhotoStore.getState().reset();
  useCollectionCoverStore.getState().reset();
}

/**
 * The session was lost (expired or revoked) rather than ended by the user:
 * stop sync and hide the account's data, but keep the outbox, cursors and
 * shadow, so the same account's unsynced edits go up when it signs back in.
 */
function stopAndHide(): void {
  stopEngine();
  useLibraryStore.setState({ tracks: [], cloudTracks: [], playlists: [], hydrated: false });
  clearAccountPlayback();
}

/** Sign-out: stop and forget all sync state (outbox, cursors, shadow). */
function stopAndClear(): void {
  const s = storage;
  stopEngine();
  void s?.clearAll();
  useLibraryStore.setState({ tracks: [], cloudTracks: [], playlists: [], hydrated: false });
  clearAccountPlayback();
}

useAuthStore.subscribe((state, prev) => {
  // Not before the device registration has been tried: starting without the id and
  // again once it lands ran two full pulls per launch.
  if (state.status === "signedIn" && state.session && state.deviceReady) {
    startEngine(state.session, state.deviceId);
  } else if (prev.status === "signedIn" && state.status === "signedOut") {
    // Only the user's own Sign out wipes unsynced edits.
    if (state.signedOutByUser) stopAndClear();
    else stopAndHide();
  }
});

// ---- startup hydration -------------------------------------------------------

/**
 * Rebuilds the whole library from the sync shadow so the app opens instantly
 * (and works offline). The web library IS the synced index: every shadowed
 * tracks row becomes a library track; favorites/ratings/playlists overlay it.
 * Pending outbox ops are replayed on top so offline edits survive reloads.
 */
async function hydrateFromShadow(): Promise<void> {
  if (!engine || !storage) return;

  const tracks = await projectTrackRows();
  const byId = new Map(tracks.map((t) => [t.id, t]));

  for (const { id, payload } of await storage.shadowAll("favorites")) {
    const row = JSON.parse(payload) as { favorite: boolean };
    const track = byId.get(id);
    if (track) track.favorite = row.favorite;
  }
  for (const { id, payload } of await storage.shadowAll("ratings")) {
    const row = JSON.parse(payload) as { rating: number };
    const track = byId.get(id);
    if (track && row.rating > 0) track.rating = row.rating;
  }

  const playlists: Playlist[] = [];
  for (const { id, payload } of await storage.shadowAll("playlists")) {
    const row = JSON.parse(payload) as PlaylistRow;
    if (row.deleted_at || row.is_folder) continue;
    const { tracks: identities } = await engine.orderedItems(id);
    playlists.push({
      id: row.id,
      name: row.name,
      trackIds: identities.map((t) => t.remoteId).filter((tid) => byId.has(tid)),
      createdAt: Date.parse(row.created_at ?? "") || Date.now(),
      isSmart: row.is_smart || undefined,
      smartRules: (row.smart_rules ?? undefined) as SmartRules | undefined,
    });
  }

  // Replay queued (unflushed) local edits over the shadow projection.
  const findByRef = (ref: TrackRef): Track | undefined => {
    if (ref.remoteId && byId.has(ref.remoteId)) return byId.get(ref.remoteId);
    if (ref.contentHash) {
      const hit = tracks.find((t) => t.contentHash === ref.contentHash);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const { op } of await storage.outboxAll()) {
    applyPendingOp(op.payload, tracks, playlists, findByRef);
  }
  await useArtistPhotoStore.getState().hydrate(storage);
  await useCollectionCoverStore.getState().hydrate(storage);

  useLibraryStore.getState().setLibrary(tracks, playlists);
}

/** Shadowed track rows → library tracks, with queued metadata edits overlaid. */
async function projectTrackRows(): Promise<Track[]> {
  if (!storage) return [];
  const rows = (await storage.shadowAll("tracks")).map(({ payload }) => JSON.parse(payload) as TrackRow);
  const ops = (await storage.outboxAll()).map(({ op }) => op);
  // Tracks deleted from the vault (anywhere): drop this browser's copies.
  for (const row of rows) if (row.deleted_at) void removeAudio(row.id).catch(() => {});
  return projectRows(rows, pendingTrackEdits(ops));
}

/** Re-projects the track list (used after a local edit is queued). */
export async function refreshTracksFromShadow(): Promise<void> {
  if (storage) useLibraryStore.getState().mergeTracks(await projectTrackRows());
}

function applyPendingOp(
  p: SyncOpPayload,
  tracks: Track[],
  playlists: Playlist[],
  findByRef: (ref: TrackRef) => Track | undefined,
): void {
  switch (p.kind) {
    case "favorite.set": {
      const track = findByRef(p.track);
      if (track) track.favorite = p.favorite;
      return;
    }
    case "rating.set": {
      const track = findByRef(p.track);
      if (track) track.rating = p.rating > 0 ? p.rating : undefined;
      return;
    }
    case "playlist.upsert": {
      const existing = playlists.find((pl) => pl.id === p.playlist.id);
      if (existing) {
        existing.name = p.playlist.name;
        existing.isSmart = p.playlist.isSmart || undefined;
        existing.smartRules = (p.playlist.smartRules ?? existing.smartRules) as Playlist["smartRules"];
      } else if (!p.playlist.isFolder) {
        playlists.push({
          id: p.playlist.id,
          name: p.playlist.name,
          trackIds: [],
          createdAt: Date.now(),
          isSmart: p.playlist.isSmart || undefined,
          smartRules: (p.playlist.smartRules ?? undefined) as Playlist["smartRules"],
        });
      }
      return;
    }
    case "playlist.delete": {
      const i = playlists.findIndex((pl) => pl.id === p.playlistId);
      if (i >= 0) playlists.splice(i, 1);
      return;
    }
    case "playlistItem.add": {
      const playlist = playlists.find((pl) => pl.id === p.playlistId);
      const track = findByRef(p.track);
      if (playlist && track && !playlist.trackIds.includes(track.id)) {
        playlist.trackIds.push(track.id);
      }
      return;
    }
    case "playlistItem.remove": {
      const playlist = playlists.find((pl) => pl.id === p.playlistId);
      const track = findByRef(p.track);
      if (playlist && track) {
        playlist.trackIds = playlist.trackIds.filter((id) => id !== track.id);
      }
      return;
    }
    case "playlist.reorder": {
      const playlist = playlists.find((pl) => pl.id === p.playlistId);
      if (!playlist) return;
      const desired = p.tracks
        .map((ref) => findByRef(ref)?.id)
        .filter((id): id is string => id !== undefined && playlist.trackIds.includes(id));
      const rest = playlist.trackIds.filter((id) => !desired.includes(id));
      playlist.trackIds = [...desired, ...rest];
      return;
    }
    default:
      return; // settings persist locally already; queue/playEvents don't project
  }
}

// ---- applying remote state -------------------------------------------------------

async function applyChanges(changes: RemoteChanges): Promise<void> {
  const library = useLibraryStore.getState();
  const settings = useSettingsStore.getState();

  // New/updated canonical tracks: re-project the whole list from the shadow
  // (cheap — it's already local) keeping user-state flags.
  if (changes.tracksChanged && storage) {
    library.mergeTracks(await projectTrackRows());
  }

  // Order matters: playlists before their items.
  for (const change of changes.playlists) {
    useLibraryStore.getState().applyRemotePlaylist(change);
  }
  for (const { playlistId, tracks } of changes.playlistItems) {
    useLibraryStore.getState().applyRemotePlaylistItems(playlistId, mapToIds(tracks));
  }
  for (const { track, favorite } of changes.favorites) {
    useLibraryStore.getState().applyRemoteFavorite(track, favorite);
  }
  for (const { track, rating } of changes.ratings) {
    useLibraryStore.getState().applyRemoteRating(track, rating);
  }
  for (const { scope, key, value } of changes.settings) {
    settings.applyRemoteSetting(scope, key, value);
    useArtistPhotoStore.getState().applyRemote(scope, key, value);
    useCollectionCoverStore.getState().applyRemote(scope, key, value);
  }
  if (changes.queue) useSyncStore.setState({ remoteQueue: changes.queue });
  if (changes.playEventsAdded > 0) refreshStatsIfLoaded();
}

function mapToIds(identities: TrackIdentity[]): string[] {
  const find = useLibraryStore.getState().findTrackByIdentity;
  return identities
    .map((identity) => find(identity)?.id)
    .filter((id): id is string => id !== undefined);
}

/**
 * Cross-device handoff, once the startup sync is done: newest wins between the song this
 * device restored and the queue another device left (handoffWins). It reads the engine's
 * copy of the server queue, since a pull reports the queue only when it changed, and
 * never touches anything the user has started or changed since startup.
 */
async function maybeRestoreQueue(): Promise<void> {
  const queue = await engine?.queueSnapshot();
  if (!queue) return;
  const player = usePlayerStore.getState();
  if (player.isPlaying) return;
  const local = {
    empty: player.queue.length === 0,
    restoredOnly: player.restoredQueue !== null && sameSongs(player.queue, player.restoredQueue),
    lastPlayedAt: loadLastPlayback()?.playedAt ?? null,
  };
  if (!handoffWins(queue, useAuthStore.getState().deviceId, local)) return;
  const tracks = queue.tracks
    .map((identity) => useLibraryStore.getState().findTrackByIdentity(identity))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  if (tracks.length === 0) return;
  const index = Math.min(Math.max(queue.currentIndex, 0), tracks.length - 1);
  // Already here (the engine started twice, or this is the queue we left): reloading the
  // library's copies would drop the resolved file paths of the loaded song.
  if (sameSongs(player.queue, tracks) && player.currentIndex === index) return;
  usePlayerStore.getState().restoreQueue(tracks, index, queue.positionSeconds);
}

function sameSongs(a: Track[], b: Track[]): boolean {
  return a.length === b.length && a.every((t, i) => t.id === b[i].id);
}

function queueKey(s: { queue: Track[]; currentIndex: number }): string {
  return `${s.currentIndex}|${s.queue.map((t) => t.id).join(",")}`;
}

// ---- pushing the local queue -------------------------------------------------------

function scheduleQueuePush(delay = QUEUE_PUSH_MS): void {
  if (!engine) return;
  if (queuePushTimer) clearTimeout(queuePushTimer);
  queuePushTimer = setTimeout(() => {
    queuePushTimer = null;
    pushQueue();
  }, delay);
}

/**
 * Pushes the queue, including an empty one — clearing the queue is a real edit
 * other devices must see, or the server's last `queue.set` keeps offering a
 * stale handoff. A queue whose tracks all lack a syncable identity is *not* a
 * cleared queue, though, so it stays unpushed rather than wiping the row.
 */
function pushQueue(): void {
  if (!engine) return;
  const player = usePlayerStore.getState();
  const settings = useSettingsStore.getState();
  const refs = player.queue
    .map((t) => refFromTrack(t))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (refs.length === 0 && player.queue.length > 0) return;
  void engine.enqueue({
    kind: "queue.set",
    tracks: refs,
    currentIndex: Math.max(0, player.currentIndex),
    positionSeconds: player.currentTime,
    shuffle: settings.shuffle,
    repeat: settings.repeat,
    editedAt: nowIso(),
  });
}
