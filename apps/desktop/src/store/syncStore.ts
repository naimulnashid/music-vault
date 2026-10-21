import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  SupabaseTransport,
  SyncEngine,
  handoffWins,
  type QueueChange,
  type RemoteChanges,
  type Session,
  type SyncStatus,
  type TrackIdentity,
} from "@musicvault/core";
import { supabase } from "../lib/supabase";
import { TauriSyncStorage } from "../lib/syncStorage";
import { nowIso, refFromTrack, setSyncEnqueue } from "../lib/syncBus";
import { loadLastPlayback } from "../lib/lastPlayback";
import { useAuthStore } from "./authStore";
import { useLibraryStore, type CloudUserState } from "./libraryStore";
import type { PendingTrackEdit } from "../lib/vaultMerge";
import type { Track } from "../types";
import { forgetDeletedTracks } from "../lib/vaultCleanup";
import * as db from "../lib/db";
import { trackRefKeys, type TrackRow as RemoteTrackRow } from "@musicvault/core";
import { useSettingsStore } from "./settingsStore";
import { usePlayerStore } from "./playerStore";
import { refreshStatsIfLoaded, resetStats } from "./statsStore";
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
let storage: TauriSyncStorage | null = null;
let engineKey: string | null = null;
let queuePushTimer: ReturnType<typeof setTimeout> | null = null;
let reapplyTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribePlayer: (() => void) | null = null;
let unsubscribeLibrary: (() => void) | null = null;
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
 * Stored sync state (and the playlists mirrored from it) belongs to one
 * account. A lost session keeps it for that account; a different account
 * signing in starts clean.
 */
async function claimStorage(s: TauriSyncStorage, userId: string): Promise<void> {
  const owner = await s.cursorGet(OWNER_CURSOR);
  if (owner && owner !== userId) {
    await s.clearAll();
    const { playlists } = useLibraryStore.getState();
    await Promise.all(playlists.map((p) => db.deletePlaylist(p.id)));
    useLibraryStore.setState({ playlists: [] });
  }
  await s.cursorSet(OWNER_CURSOR, userId);
}

function startEngine(session: Session, deviceId: string | null): void {
  if (!supabase) return;
  const client = supabase;
  const key = `${session.user.id}/${deviceId ?? ""}`;
  if (engineKey === key) return; // already running for this identity
  stopEngine();
  engineKey = key;

  storage = new TauriSyncStorage();
  engine = new SyncEngine(new SupabaseTransport(supabase, session.user.id), storage, {
    deviceId,
    onChanges: (changes) => void applyChanges(changes),
    onStatus: (status) => useSyncStore.setState({ status }),
    // An expired token is renewed once per cycle; failing that the status asks to sign in again.
    refreshAuth: async () => {
      const { error } = await client.auth.refreshSession();
      if (error) throw error;
    },
    // Breadcrumbs go to the rotating appdata log via Rust (best-effort).
    onBreadcrumb: (crumb) =>
      void invoke("sync_breadcrumb", {
        event: crumb.event,
        detail: crumb.detail ? JSON.stringify(crumb.detail) : null,
      }).catch(() => {}),
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

  // Playlist items pulled before their tracks' rows could resolve them get
  // another mapping pass when the track rows change.
  unsubscribeLibrary = useLibraryStore.subscribe((state, prev) => {
    if (state.vaultRows !== prev.vaultRows) scheduleReapplyPlaylists();
  });

  const claimed = storage;
  void (async () => {
    try {
      await claimStorage(claimed, session.user.id);
      await engine!.init();
      await hydrateFromShadow();
      await loadVaultRows();
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
  if (reapplyTimer) clearTimeout(reapplyTimer);
  reapplyTimer = null;
  unsubscribePlayer?.();
  unsubscribePlayer = null;
  unsubscribeLibrary?.();
  unsubscribeLibrary = null;
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
}

/**
 * The session was lost (expired or revoked) rather than ended by the user:
 * stop sync and hide the account's vault songs and favorites, but keep the
 * outbox, cursors, shadow and mirrored playlists, so the same account's
 * unsynced edits go up when it signs back in.
 */
function stopAndHide(): void {
  stopEngine();
  useLibraryStore.setState({ cloudState: { favorites: {}, ratings: {} } });
  useLibraryStore.getState().setVaultRows([], []);
  clearAccountPlayback();
}

/**
 * Sign-out: stop and forget all sync state (outbox, cursors, shadow) and the
 * playlists mirrored from the account, so the next account starts clean.
 */
function stopAndClear(): void {
  const s = storage;
  stopEngine();
  void s?.clearAll();
  const { playlists } = useLibraryStore.getState();
  void Promise.all(playlists.map((p) => db.deletePlaylist(p.id))).catch((err) =>
    console.error("[sync] clearing playlists failed:", err),
  );
  useLibraryStore.setState({ playlists: [], cloudState: { favorites: {}, ratings: {} } });
  useLibraryStore.getState().setVaultRows([], []);
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

// ---- applying remote state -------------------------------------------------------

async function applyChanges(changes: RemoteChanges): Promise<void> {
  const library = useLibraryStore.getState();
  const settings = useSettingsStore.getState();

  // Track rows first (edits, uploads, deletions from any device), so later
  // steps can resolve the tracks they mention.
  if (changes.tracksChanged) await loadVaultRows();

  // Order matters: playlists before their items.
  for (const change of changes.playlists) {
    await library.applyRemotePlaylist(change);
  }
  for (const { playlistId, tracks } of changes.playlistItems) {
    await useLibraryStore.getState().applyRemotePlaylistItems(playlistId, mapToLocalIds(tracks));
  }
  for (const { track, favorite } of changes.favorites) {
    await library.applyRemoteFavorite(track, favorite);
  }
  for (const { track, rating } of changes.ratings) {
    await library.applyRemoteRating(track, rating);
  }
  for (const { scope, key, value } of changes.settings) {
    settings.applyRemoteSetting(scope, key, value);
  }
  if (changes.queue) useSyncStore.setState({ remoteQueue: changes.queue });
  if (changes.playEventsAdded > 0) refreshStatsIfLoaded();
}

function mapToLocalIds(identities: TrackIdentity[]): string[] {
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

// ---- re-mapping playlist items when the library grows -------------------------------

function scheduleReapplyPlaylists(): void {
  if (!engine) return;
  if (reapplyTimer) clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => {
    reapplyTimer = null;
    void reapplyPlaylistsFromShadow();
  }, 1000);
}

/**
 * Re-projects every shadowed playlist's items onto local playlists. Skipped
 * while local edits are queued — the shadow is behind the user's intent then,
 * and the flush + pull that clears the outbox reconciles everything anyway.
 */
async function reapplyPlaylistsFromShadow(): Promise<void> {
  if (!engine || !storage) return;
  if ((useSyncStore.getState().status?.pendingOps ?? 0) > 0) return;
  try {
    for (const { id, payload } of await storage.shadowAll("playlists")) {
      const row = JSON.parse(payload) as { deleted_at: string | null };
      if (row.deleted_at) continue;
      const { tracks } = await engine.orderedItems(id);
      if (tracks.length === 0) continue;
      await useLibraryStore.getState().applyRemotePlaylistItems(id, mapToLocalIds(tracks));
    }
  } catch (err) {
    console.error("[sync] playlist re-apply failed:", err);
  }
}

// ---- track rows (the vault + online metadata) ----------------------------------------

/**
 * Projects the shadowed `tracks` rows and the still-queued track.edit ops into
 * the library: vault tracks appear, online edits overlay every track.
 */
async function loadVaultRows(): Promise<void> {
  if (!storage) return;
  try {
    const rows = (await storage.shadowAll("tracks")).map(({ payload }) => JSON.parse(payload) as RemoteTrackRow);
    const pending: PendingTrackEdit[] = [];
    for (const { op } of await storage.outboxAll()) {
      if (op.payload.kind === "track.edit") {
        pending.push({ keys: trackRefKeys(op.payload.track), patch: op.payload.patch, editedAt: op.payload.editedAt });
      }
    }
    useLibraryStore.getState().setVaultRows(rows, pending);
    // Tracks deleted from the vault (anywhere): their local copies go too.
    await forgetDeletedTracks(rows);
  } catch (err) {
    console.error("[sync] loading track rows failed:", err);
  }
}

// ---- startup hydration & one-time seeding ------------------------------------------

/**
 * Rebuilds the cloud-track favorites/ratings overlay from the sync shadow so
 * cloud-only user state survives restarts without waiting for a pull.
 */
async function hydrateFromShadow(): Promise<void> {
  if (!storage) return;
  const tracks = new Map<string, { content_hash: string | null }>();
  for (const { id, payload } of await storage.shadowAll("tracks")) {
    tracks.set(id, JSON.parse(payload) as { content_hash: string | null });
  }
  const keysOf = (trackId: string): string[] => {
    const t = tracks.get(trackId);
    if (!t) return [];
    const keys: string[] = [];
    if (t.content_hash) keys.push(`hash:${t.content_hash}`);
    return keys;
  };

  const cloudState: CloudUserState = { favorites: {}, ratings: {} };
  for (const { id, payload } of await storage.shadowAll("favorites")) {
    const row = JSON.parse(payload) as { favorite: boolean };
    for (const key of keysOf(id)) cloudState.favorites[key] = row.favorite;
  }
  for (const { id, payload } of await storage.shadowAll("ratings")) {
    const row = JSON.parse(payload) as { rating: number };
    for (const key of keysOf(id)) cloudState.ratings[key] = row.rating;
  }
  if (Object.keys(cloudState.favorites).length > 0 || Object.keys(cloudState.ratings).length > 0) {
    useLibraryStore.getState().setCloudUserState(cloudState);
  }
}
