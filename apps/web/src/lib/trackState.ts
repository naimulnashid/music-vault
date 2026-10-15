/**
 * Per-song download/vault state behind one small API, so the shared UI
 * components (track rows, menus, player bar) read the same on desktop and
 * web. The web keys downloads by track id and keeps cached/pinned flags on
 * the track itself.
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDownloadStore, type DownloadProgressState } from "../store/downloadStore";
import { useLibraryStore } from "../store/libraryStore";
import { usePlayerStore } from "../store/playerStore";
import type { Track } from "../types";

/** Kept on this device (explicit download, never auto-evicted). */
export function useIsPinned(track: Pick<Track, "pinned"> | null | undefined): boolean {
  return !!track?.pinned;
}

/** Live transfer progress while the song's audio downloads. */
export function useTrackDownload(track: Pick<Track, "id"> | null | undefined): DownloadProgressState | undefined {
  return useDownloadStore((s) => (track ? s.downloadProgress[track.id] : undefined));
}

/** Whether the song's audio is still being fetched before it can play. */
export function useAwaitingAudio(track: Track | null | undefined): boolean {
  return usePlayerStore((s) => !!track && s.resolvingId === track.id);
}

export function downloadTracks(tracks: Track[]): Promise<void> {
  return useDownloadStore.getState().downloadTracks(tracks);
}

export function removeDownload(track: Track): Promise<void> {
  return useDownloadStore.getState().removeDownload(track.id);
}

/** Download state of a collection (album, artist, playlist) for its Download button. */
export interface CollectionDownload {
  /** Songs that can be downloaded (in the vault). */
  total: number;
  /** Of those, kept in this browser. */
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
  const ids = useMemo(() => [...new Set(tracks.filter((t) => t.storageKey).map((t) => t.id))], [tracks]);
  // Pinned flags live on the library's tracks, which update when downloads land.
  const pinnedIds = useLibraryStore(
    useShallow((s) => {
      const wanted = new Set(ids);
      return s.tracks.filter((t) => t.pinned && wanted.has(t.id)).map((t) => t.id);
    }),
  );
  const { active, partial } = useDownloadStore(
    useShallow((s) => {
      let active = 0;
      let partial = 0;
      for (const id of ids) {
        if (!s.queued.has(id)) continue;
        active++;
        const p = s.downloadProgress[id];
        if (p && p.total > 0) partial += Math.min(1, p.downloaded / p.total);
      }
      return { active, partial };
    }),
  );
  const done = pinnedIds.length;
  const store = useDownloadStore.getState;
  return {
    total: ids.length,
    done,
    active,
    ratio: ids.length > 0 ? (done + partial) / ids.length : 0,
    download: () => void store().downloadTracks(tracks),
    cancel: () => void store().cancelDownloads(ids),
    remove: () => void store().removeDownloads(pinnedIds),
  };
}

/** The song is in the vault and this account may delete it. */
export function canDeleteFromVault(track: Track): boolean {
  return !!track.storageKey;
}
