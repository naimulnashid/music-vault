import { create } from "zustand";
import {
  onVaultDownloadDone,
  onVaultDownloadError,
  onVaultDownloadProgress,
  vaultCacheClear,
  vaultCacheSetMax,
  vaultCacheStats,
  vaultDownloadCancel,
  vaultDownloadRemove,
  vaultDownloadsList,
  type CacheEntryRow,
  type CacheStats,
} from "../lib/ipc";
import { ensureVaultLocal } from "../lib/vault";
import { emitAppError } from "../lib/errorBus";
import { downloadFailureMessage, type DownloadFailure } from "../lib/downloadError";
import { useLibraryStore } from "./libraryStore";
import type { Track } from "../types";

/** How many tracks to download at once (Rust locks and dedupes per track). */
const DOWNLOAD_CONCURRENCY = 4;
const AUTO_DOWNLOAD_KEY = "mv.autoDownload";

export interface DownloadProgressState {
  downloaded: number;
  total: number;
}

/**
 * This device's copies of vault audio: the two-tier cache (auto + pinned,
 * keyed `vault:<contentHash>`), the download queue with its progress, the
 * cache cap, and auto-download (keep the whole vault on this device).
 */
interface DownloadStoreState {
  /** In-flight downloads by cache key. */
  downloadProgress: Record<string, DownloadProgressState>;
  /** Cache keys waiting for or in a pinned download. */
  queued: Set<string>;
  /** Everything in the two-tier cache (auto + pinned). */
  cacheEntries: CacheEntryRow[];
  /** Cache keys of pinned downloads, for row badges and buttons. */
  pinnedKeys: Set<string>;
  cacheStats: CacheStats | null;
  /** Device-local: download every vault song, and drop the auto-cache. */
  autoDownload: boolean;
  /** Wires download events (once), loads the cache index, starts auto-download. */
  init: () => Promise<void>;
  /** Queues pinned downloads; resolves when these tracks are done or cancelled. */
  downloadTracks: (tracks: Track[]) => Promise<void>;
  /** Pins every track in the library. */
  downloadAll: () => Promise<void>;
  /** Drops queued downloads and stops in-flight ones. */
  cancelDownloads: (keys: string[]) => Promise<void>;
  removeDownload: (fileId: string) => Promise<void>;
  removeDownloads: (fileIds: string[]) => Promise<void>;
  refreshDownloads: () => Promise<void>;
  setCacheMax: (bytes: number) => Promise<void>;
  clearCache: () => Promise<void>;
  setAutoDownload: (on: boolean) => void;
}

export const keyOf = (track: Pick<Track, "contentHash">) => `vault:${track.contentHash}`;

let listenersAttached = false;
const pending: Track[] = [];
const inFlight = new Set<string>();
let workers = 0;

function loadAutoDownload(): boolean {
  try {
    return localStorage.getItem(AUTO_DOWNLOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function clearProgress(fileId: string) {
  useDownloadStore.setState((s) => {
    const { [fileId]: _done, ...rest } = s.downloadProgress;
    return { downloadProgress: rest };
  });
}

function dequeue(keys: string[]) {
  useDownloadStore.setState((s) => {
    const queued = new Set(s.queued);
    keys.forEach((k) => queued.delete(k));
    return { queued };
  });
}

/** Failures of the current run, reported together when the last worker finishes. */
const failures: DownloadFailure[] = [];

async function worker(): Promise<void> {
  workers++;
  try {
    for (let track = pending.shift(); track; track = pending.shift()) {
      const key = keyOf(track);
      inFlight.add(key);
      try {
        await ensureVaultLocal(track, true);
      } catch (err) {
        if (!String(err).includes("cancelled")) {
          console.error("[downloads] download failed:", track.title, err);
          failures.push({ title: track.title, err });
        }
      } finally {
        inFlight.delete(key);
        dequeue([key]);
      }
    }
  } finally {
    workers--;
    if (workers === 0) {
      const message = downloadFailureMessage(failures.splice(0));
      if (message) emitAppError(message);
      void useDownloadStore.getState().refreshDownloads();
    }
  }
}

/** Resolves once none of `keys` is queued any more. */
function whenSettled(keys: string[]): Promise<void> {
  const settled = () => !keys.some((k) => useDownloadStore.getState().queued.has(k));
  if (settled()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useDownloadStore.subscribe(() => {
      if (settled()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/** Auto-download: queue every vault song this device doesn't keep yet. */
function syncAutoDownload() {
  const { autoDownload, pinnedKeys, queued, downloadTracks } = useDownloadStore.getState();
  if (!autoDownload) return;
  const missing = useLibraryStore
    .getState()
    .tracks.filter((t) => t.storageKey && t.contentHash && !pinnedKeys.has(keyOf(t)) && !queued.has(keyOf(t)));
  if (missing.length > 0) void downloadTracks(missing);
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  downloadProgress: {},
  queued: new Set(),
  cacheEntries: [],
  pinnedKeys: new Set(),
  cacheStats: null,
  autoDownload: loadAutoDownload(),

  init: async () => {
    const first = !listenersAttached;
    if (first) {
      listenersAttached = true;
      void onVaultDownloadProgress(({ fileId, downloaded, total }) => {
        set((s) => ({ downloadProgress: { ...s.downloadProgress, [fileId]: { downloaded, total } } }));
      });
      void onVaultDownloadDone(({ fileId }) => {
        clearProgress(fileId);
        void get().refreshDownloads();
      });
      void onVaultDownloadError(({ fileId, message }) => {
        clearProgress(fileId);
        if (message !== "cancelled") console.error("[downloads] failed:", fileId, message);
      });
    }
    await get().refreshDownloads();
    // Only once the pinned set is known, or every song would be queued (and signed) again.
    if (first) {
      // New songs in the vault download on their own; deleted ones are
      // dropped by the sync store (forgetDeletedTracks).
      useLibraryStore.subscribe((s, prev) => {
        if (s.tracks !== prev.tracks) syncAutoDownload();
      });
    }
    syncAutoDownload();
  },

  downloadTracks: async (tracks) => {
    const { queued, pinnedKeys } = get();
    const fresh = tracks.filter(
      (t, i, all) =>
        t.storageKey &&
        t.contentHash &&
        !queued.has(keyOf(t)) &&
        !pinnedKeys.has(keyOf(t)) &&
        all.findIndex((o) => o.contentHash === t.contentHash) === i,
    );
    if (fresh.length > 0) {
      pending.push(...fresh);
      set((s) => ({ queued: new Set([...s.queued, ...fresh.map(keyOf)]) }));
      while (workers < DOWNLOAD_CONCURRENCY && pending.length > 0) void worker();
    }
    await whenSettled(tracks.filter((t) => t.contentHash).map(keyOf));
  },

  downloadAll: async () => {
    await get().downloadTracks(useLibraryStore.getState().tracks);
  },

  cancelDownloads: async (keys) => {
    const wanted = new Set(keys);
    for (let i = pending.length - 1; i >= 0; i--) {
      if (wanted.has(keyOf(pending[i]))) pending.splice(i, 1);
    }
    const running = keys.filter((k) => inFlight.has(k));
    dequeue(keys.filter((k) => !inFlight.has(k)));
    if (running.length > 0) {
      try {
        await vaultDownloadCancel(running);
      } catch (err) {
        console.error("[downloads] cancel failed:", err);
      }
    }
  },

  removeDownload: (fileId) => get().removeDownloads([fileId]),

  removeDownloads: async (fileIds) => {
    let stuck = 0;
    for (const fileId of fileIds) {
      try {
        await vaultDownloadRemove(fileId);
      } catch (err) {
        console.error("[downloads] remove failed:", err);
        stuck++;
      }
    }
    // The file stays listed (and counted) when it couldn't be deleted; say why.
    if (stuck > 0) {
      emitAppError(
        stuck === 1
          ? "Couldn't remove a download: the file is in use. Try again after it stops playing."
          : `Couldn't remove ${stuck} downloads: the files are in use. Try again after they stop playing.`,
      );
    }
    await get().refreshDownloads();
  },

  refreshDownloads: async () => {
    try {
      const [cacheEntries, cacheStats] = await Promise.all([vaultDownloadsList(), vaultCacheStats()]);
      const pinnedKeys = new Set(cacheEntries.filter((e) => e.pinned).map((e) => e.fileId));
      set({ cacheEntries, cacheStats, pinnedKeys });
    } catch (err) {
      console.error("[downloads] refresh failed:", err);
    }
  },

  setCacheMax: async (bytes) => {
    try {
      const cacheStats = await vaultCacheSetMax(bytes);
      set({ cacheStats });
      await get().refreshDownloads();
    } catch (err) {
      console.error("[downloads] cache cap update failed:", err);
    }
  },

  clearCache: async () => {
    try {
      set({ cacheStats: await vaultCacheClear() });
      await get().refreshDownloads();
    } catch (err) {
      console.error("[downloads] clear cache failed:", err);
    }
  },

  setAutoDownload: (on) => {
    try {
      localStorage.setItem(AUTO_DOWNLOAD_KEY, on ? "1" : "0");
    } catch {
      // storage unavailable: the choice lasts until restart
    }
    set({ autoDownload: on });
    // Songs already in the auto-cache are moved into downloads, not fetched again.
    if (on) syncAutoDownload();
  },
}));
