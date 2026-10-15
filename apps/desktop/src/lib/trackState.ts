/**
 * Per-song download/vault state behind one small API, so the shared UI
 * components (track rows, menus, player bar) read the same on desktop and
 * web. Desktop keys downloads by "vault:<contentHash>".
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { keyOf, useDownloadStore, type DownloadProgressState } from "../store/downloadStore";
import type { Track } from "../types";

/** Kept on this device (explicit download, never auto-evicted). */
export function useIsPinned(track: Pick<Track, "contentHash"> | null | undefined): boolean {
  return useDownloadStore((s) => (track?.contentHash ? s.pinnedKeys.has(keyOf(track)) : false));
}

/** Live transfer progress while the song's audio downloads. */
export function useTrackDownload(track: Pick<Track, "contentHash"> | null | undefined): DownloadProgressState | undefined {
  return useDownloadStore((s) => (track?.contentHash ? s.downloadProgress[keyOf(track)] : undefined));
}

/** Whether the song's audio is still being fetched before it can play. */
export function useAwaitingAudio(track: Track | null | undefined): boolean {
  return !!track && !track.path;
}

export function downloadTracks(tracks: Track[]): Promise<void> {
  return useDownloadStore.getState().downloadTracks(tracks);
}

export function removeDownload(track: Track): Promise<void> {
  return useDownloadStore.getState().removeDownload(keyOf(track));
}

/** Download state of a collection (album, artist, playlist) for its Download button. */
export interface CollectionDownload {
  /** Songs that can be downloaded (in the vault). */
  total: number;
  /** Of those, kept on this device. */
  done: number;
  /** Queued or downloading right now. */
  active: number;
  /** 0..1 across the whole collection, counting partial transfers. */
  ratio: number;
  download: () => void;
  cancel: () => void;
  remove: () => void;
}

export function useCollectionDownload(tracks: Track[]): CollectionDownload {
  const keys = useMemo(
    () => [...new Set(tracks.filter((t) => t.storageKey && t.contentHash).map(keyOf))],
    [tracks],
  );
  const { done, active, partial } = useDownloadStore(
    useShallow((s) => {
      let done = 0;
      let active = 0;
      let partial = 0;
      for (const k of keys) {
        if (s.pinnedKeys.has(k)) done++;
        else if (s.queued.has(k)) {
          active++;
          const p = s.downloadProgress[k];
          if (p && p.total > 0) partial += Math.min(1, p.downloaded / p.total);
        }
      }
      return { done, active, partial };
    }),
  );
  const store = useDownloadStore.getState;
  return {
    total: keys.length,
    done,
    active,
    ratio: keys.length > 0 ? (done + partial) / keys.length : 0,
    download: () => void store().downloadTracks(tracks),
    cancel: () => void store().cancelDownloads(keys),
    remove: () => void store().removeDownloads(keys.filter((k) => store().pinnedKeys.has(k))),
  };
}

/** The song is in the vault and this account may delete it. */
export function canDeleteFromVault(track: Track): boolean {
  return !!track.storageKey && !!track.remoteId;
}
