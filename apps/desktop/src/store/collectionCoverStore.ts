import { create } from "zustand";
import { COLLECTION_COVER_SCOPE, artistPhotoKey, collectionCoverOp, loadCollectionCovers, type SyncStorage } from "@musicvault/core";
import { nowIso, syncEnqueue } from "../lib/syncBus";

/**
 * Covers picked for playlists and smart groups, synced as settings rows (core
 * collectionCovers.ts). Kept 1:1 between the desktop and web apps.
 */
interface CollectionCoverState {
  /** Collection key ("playlist:<id>", "country:Bangladesh") → cover key. */
  covers: Record<string, string>;
  /** Collections whose new cover is still uploading. */
  uploading: string[];
  setUploading: (collection: string, on: boolean) => void;
  /** From the sync shadow plus queued edits, at startup. */
  hydrate: (storage: SyncStorage) => Promise<void>;
  applyRemote: (scope: string, collection: string, value: unknown) => void;
  /** Sets (or with null, resets to the default) a cover and queues the change for sync. */
  setCover: (collection: string, artworkKey: string | null) => void;
  reset: () => void;
}

function withCover(covers: Record<string, string>, collection: string, key: string | null): Record<string, string> {
  const next = { ...covers };
  if (key) next[collection] = key;
  else delete next[collection];
  return next;
}

export const useCollectionCoverStore = create<CollectionCoverState>((set) => ({
  covers: {},
  uploading: [],
  setUploading: (collection, on) =>
    set((state) => ({ uploading: on ? [...state.uploading, collection] : state.uploading.filter((c) => c !== collection) })),
  hydrate: async (storage) => {
    try {
      set({ covers: await loadCollectionCovers(storage) });
    } catch (err) {
      console.error("[collection covers] load failed:", err);
    }
  },
  applyRemote: (scope, collection, value) => {
    if (scope !== COLLECTION_COVER_SCOPE) return;
    set((state) => ({ covers: withCover(state.covers, collection, artistPhotoKey(value)) }));
  },
  setCover: (collection, artworkKey) => {
    set((state) => ({ covers: withCover(state.covers, collection, artworkKey) }));
    syncEnqueue(collectionCoverOp(collection, artworkKey, nowIso()));
  },
  reset: () => set({ covers: {} }),
}));
