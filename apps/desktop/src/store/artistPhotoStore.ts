import { create } from "zustand";
import { ARTIST_PHOTO_SCOPE, artistPhotoKey, artistPhotoOp, loadArtistPhotos, type SyncStorage } from "@musicvault/core";
import { nowIso, syncEnqueue } from "../lib/syncBus";

/**
 * Artist photos, synced as settings rows (core artistPhotos.ts). Kept 1:1
 * between the desktop and web apps.
 */
interface ArtistPhotoState {
  /** Artist name → cover key of the photo picked for them. */
  photos: Record<string, string>;
  /** From the sync shadow plus queued edits, at startup. */
  hydrate: (storage: SyncStorage) => Promise<void>;
  applyRemote: (scope: string, artist: string, value: unknown) => void;
  /** Sets (or with null, removes) a photo and queues the change for sync. */
  setPhoto: (artist: string, artworkKey: string | null) => void;
  reset: () => void;
}

function withPhoto(photos: Record<string, string>, artist: string, key: string | null): Record<string, string> {
  const next = { ...photos };
  if (key) next[artist] = key;
  else delete next[artist];
  return next;
}

export const useArtistPhotoStore = create<ArtistPhotoState>((set) => ({
  photos: {},
  hydrate: async (storage) => {
    try {
      set({ photos: await loadArtistPhotos(storage) });
    } catch (err) {
      console.error("[artist photos] load failed:", err);
    }
  },
  applyRemote: (scope, artist, value) => {
    if (scope !== ARTIST_PHOTO_SCOPE) return;
    set((state) => ({ photos: withPhoto(state.photos, artist, artistPhotoKey(value)) }));
  },
  setPhoto: (artist, artworkKey) => {
    set((state) => ({ photos: withPhoto(state.photos, artist, artworkKey) }));
    syncEnqueue(artistPhotoOp(artist, artworkKey, nowIso()));
  },
  reset: () => set({ photos: {} }),
}));
