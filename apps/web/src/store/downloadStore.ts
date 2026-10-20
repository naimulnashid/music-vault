import { create } from "zustand";
import {
  allEntries,
  cacheStats,
  clearAutoCache,
  evictOverCap,
  pinTrack,
  removeAudio,
  setCacheMaxBytes,
  type CacheStats,
} from "../lib/audioCache";
import type { AudioEntry } from "../lib/db";
import { emitAppError } from "../lib/errorBus";
import { downloadFailureMessage, type DownloadFailure } from "../lib/downloadError";
import { useLibraryStore } from "./libraryStore";
import type { Track } from "../types";

const AUTO_DOWNLOAD_KEY = "mv.autoDownload";

export interface DownloadProgressState {
  downloaded: number;
  total: number;
}

/**
 * This browser's copies of vault audio: the two-tier OPFS store (auto-cache +
 * pinned downloads), the download queue with its progress, and the cache cap.
 */
interface DownloadStoreState {
  /** In-flight downloads by track id. */
  downloadProgress: Record<string, DownloadProgressState>;
  /** Track ids waiting for or in a pinned download. */
  queued: Set<string>;
  /** Everything in the two-tier store (auto + pinned). */
  cacheEntries: AudioEntry[];
  cacheStats: CacheStats | null;
  /** Browser-local: download every vault song, and skip the auto-cache. */
  autoDownload: boolean;
  /** Loads the store index once and starts auto-download. */
  init: () => Promise<void>;
  setAutoDownload: (on: boolean) => void;
  /** Queues pinned downloads; resolves when these tracks are done or cancelled. */
  downloadTracks: (tracks: Track[]) => Promise<void>;
  /** Drops queued downloads and stops the running one if it is among them. */
  cancelDownloads: (trackIds: string[]) => Promise<void>;
  removeDownload: (trackId: string) => Promise<void>;
  removeDownloads: (trackIds: string[]) => Promise<void>;
  refreshDownloads: () => Promise<void>;
  setCacheMax: (bytes: number) => Promise<void>;
  clearCache: () => Promise<void>;
  /** Progress reporting used by the audio resolver too. */
  reportProgress: (trackId: string, p: DownloadProgressState | null) => void;
}

async function applyAudioFlags(): Promise<void> {
  const entries = await allEntries();
  const flags = new Map(
    entries.map((e) => [e.trackId, { cached: e.tier === "cache", pinned: e.tier === "pin" }]),
  );
  useLibraryStore.getState().setAudioFlags(flags);
}

function loadAutoDownload(): boolean {
  try {
    return localStorage.getItem(AUTO_DOWNLOAD_KEY) === "1";
  } catch {
    return false;
  }
}

/** Auto-download: queue every vault song this browser doesn't keep yet. */
function syncAutoDownload() {
  const { autoDownload, queued, downloadTracks } = useDownloadStore.getState();
  if (!autoDownload) return;
  const missing = useLibraryStore.getState().tracks.filter((t) => t.storageKey && !t.pinned && !queued.has(t.id));
  if (missing.length > 0) void downloadTracks(missing);
}

let initialized = false;

const pending: Track[] = [];
/** The download running now and how to stop it. */
let running: { id: string; abort: AbortController } | null = null;

function dequeue(ids: string[]) {
  useDownloadStore.setState((s) => {
    const queued = new Set(s.queued);
    ids.forEach((id) => queued.delete(id));
    return { queued };
  });
}

/**
 * One download at a time on purpose: one big transfer beats saturating the
 * link with a dozen parallel ones.
 */
/** Failures of the current run, reported together when the queue drains. */
const failures: DownloadFailure[] = [];

async function pump(): Promise<void> {
  if (running) return;
  const store = useDownloadStore.getState;
  for (let track = pending.shift(); track; track = pending.shift()) {
    const abort = new AbortController();
    running = { id: track.id, abort };
    try {
      await pinTrack(track, (p) => store().reportProgress(track!.id, p), abort.signal);
      // Each finished song shows its tick straight away, not when the batch ends.
      await applyAudioFlags();
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[downloads] download failed:", track.title, err);
        failures.push({ title: track.title, err });
      }
    } finally {
      store().reportProgress(track.id, null);
      running = null;
      dequeue([track.id]);
    }
  }
  const message = downloadFailureMessage(failures.splice(0));
  if (message) emitAppError(message);
  await store().refreshDownloads();
}

/** Resolves once none of `ids` is queued any more. */
function whenSettled(ids: string[]): Promise<void> {
  const settled = () => !ids.some((id) => useDownloadStore.getState().queued.has(id));
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

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  downloadProgress: {},
  queued: new Set(),
  cacheEntries: [],
  cacheStats: null,
  autoDownload: loadAutoDownload(),

  init: async () => {
    if (initialized) return;
    initialized = true;
    // Pinned flags first, or every song would look missing and be queued again.
    await get().refreshDownloads();
    // New songs in the vault download on their own; deleted ones are dropped
    // with their vault rows (deletedVaultHashes).
    useLibraryStore.subscribe((s, prev) => {
      if (s.tracks !== prev.tracks) syncAutoDownload();
    });
    syncAutoDownload();
  },

  setAutoDownload: (on) => {
    try {
      localStorage.setItem(AUTO_DOWNLOAD_KEY, on ? "1" : "0");
    } catch {
      // storage unavailable: the choice lasts until reload
    }
    set({ autoDownload: on });
    // Songs already in the auto-cache are re-tiered as downloads, not fetched again.
    if (on) syncAutoDownload();
  },

  downloadTracks: async (tracks) => {
    const { queued } = get();
    const fresh = tracks.filter((t, i, all) => t.storageKey && !t.pinned && !queued.has(t.id) && all.indexOf(t) === i);
    if (fresh.length > 0) {
      pending.push(...fresh);
      set((s) => ({ queued: new Set([...s.queued, ...fresh.map((t) => t.id)]) }));
      void pump();
    }
    await whenSettled(tracks.map((t) => t.id));
  },

  cancelDownloads: async (trackIds) => {
    const wanted = new Set(trackIds);
    for (let i = pending.length - 1; i >= 0; i--) {
      if (wanted.has(pending[i].id)) pending.splice(i, 1);
    }
    if (running && wanted.has(running.id)) running.abort.abort();
    dequeue(trackIds.filter((id) => id !== running?.id));
  },

  removeDownload: (trackId) => get().removeDownloads([trackId]),

  removeDownloads: async (trackIds) => {
    for (const trackId of trackIds) {
      try {
        await removeAudio(trackId);
      } catch (err) {
        console.error("[downloads] remove failed:", err);
      }
    }
    await get().refreshDownloads();
  },

  refreshDownloads: async () => {
    try {
      const [entries, stats] = await Promise.all([allEntries(), cacheStats()]);
      set({ cacheEntries: entries, cacheStats: stats });
      await applyAudioFlags();
    } catch (err) {
      console.error("[downloads] refresh failed:", err);
    }
  },

  setCacheMax: async (bytes) => {
    setCacheMaxBytes(bytes);
    await evictOverCap();
    await get().refreshDownloads();
  },

  clearCache: async () => {
    await clearAutoCache();
    await get().refreshDownloads();
  },

  reportProgress: (trackId, p) => {
    set((s) => {
      if (p === null) {
        const { [trackId]: _done, ...rest } = s.downloadProgress;
        return { downloadProgress: rest };
      }
      return { downloadProgress: { ...s.downloadProgress, [trackId]: p } };
    });
  },
}));
