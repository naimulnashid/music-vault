import { create } from "zustand";
import {
  emptySmartRules,
  normalizeTrackPatch,
  trackRefKeys,
  type PlaylistChange,
  type SmartRules,
  type TrackEditPatch,
  type TrackIdentity,
  type TrackRow as RemoteTrackRow,
} from "@musicvault/core";
import type { Playlist, Track } from "../types";
import * as db from "../lib/db";
import { projectVault, type PendingTrackEdit } from "../lib/vaultMerge";
import { fetchVaultArt, vaultApi } from "../lib/vault";
import { nowIso, refFromTrack, syncEnqueue } from "../lib/syncBus";
import { useAuthStore } from "./authStore";

export type SortKey = "title" | "artist" | "album";

/**
 * Favorites and ratings, keyed by "hash:<blake3>". Persisted through the sync
 * shadow and hydrated by the sync store; the library overlays them.
 */
export interface CloudUserState {
  favorites: Record<string, boolean>;
  ratings: Record<string, number>;
}

function hashKeys(contentHash: string | null | undefined): string[] {
  return contentHash ? [`hash:${contentHash}`] : [];
}

interface LibraryState {
  /** The library: every track in the vault, with favorites/ratings overlaid. */
  tracks: Track[];
  /** Every canonical track row from the sync shadow (incl. tombstones). */
  vaultRows: RemoteTrackRow[];
  /** track.edit ops still in the outbox, overlaid until they flush. */
  pendingEdits: PendingTrackEdit[];
  /** Online cover key → cached artwork file name. */
  vaultArt: Record<string, string>;
  cloudState: CloudUserState;
  playlists: Playlist[];
  search: string;
  sortKey: SortKey;
  /** Loads the playlists from SQLite. */
  loadFromDb: () => Promise<void>;
  /** Called by the sync store with the shadowed track rows and queued edits. */
  setVaultRows: (rows: RemoteTrackRow[], pending: PendingTrackEdit[]) => void;
  /**
   * Edits metadata online (track.edit, field-level LWW) for one or more
   * tracks. Throws a TrackEditError for invalid input, or when signed out.
   */
  editTracks: (trackIds: string[], patch: Record<string, unknown>) => void;
  /** Registers a cover this device just uploaded, so it shows before any download. */
  adoptVaultArt: (artworkKey: string, fileName: string) => void;
  /** "Delete from vault": removes the audio and the track's history online. */
  deleteFromVault: (trackIds: string[]) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setSearch: (search: string) => void;
  setSortKey: (key: SortKey) => void;
  createPlaylist: (name: string) => Promise<string>;
  createSmartPlaylist: (name: string, rules?: SmartRules) => Promise<string>;
  updateSmartRules: (id: string, rules: SmartRules) => Promise<void>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylist: (playlistId: string, trackIds: string[]) => Promise<void>;

  // ---- sync engine integration (no re-enqueue: remote is authoritative) ----
  /** Bulk overlay hydration from the sync shadow at startup. */
  setCloudUserState: (state: CloudUserState) => void;
  /** Maps a remote track identity to a track in the library, if any. */
  findTrackByIdentity: (identity: TrackIdentity) => Track | undefined;
  applyRemoteFavorite: (identity: TrackIdentity, favorite: boolean) => Promise<void>;
  applyRemoteRating: (identity: TrackIdentity, rating: number) => Promise<void>;
  applyRemotePlaylist: (change: PlaylistChange) => Promise<void>;
  applyRemotePlaylistItems: (playlistId: string, trackIds: string[]) => Promise<void>;
}

function sortTracks(tracks: Track[], key: SortKey): Track[] {
  return [...tracks].sort((a, b) => a[key].localeCompare(b[key]) || a.title.localeCompare(b.title));
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  /** Recomputes the track list from the vault rows, edits, covers and user state. */
  const merged = (state: Pick<LibraryState, "sortKey" | "cloudState" | "vaultRows" | "pendingEdits" | "vaultArt">) => {
    const list = projectVault(state.vaultRows, state.pendingEdits, state.vaultArt).map((t) => {
      const keys = hashKeys(t.contentHash);
      const favorite = keys.map((k) => state.cloudState.favorites[k]).find((v) => v !== undefined);
      const rating = keys.map((k) => state.cloudState.ratings[k]).find((v) => v !== undefined);
      if (favorite === undefined && rating === undefined) return t;
      return {
        ...t,
        favorite: favorite ?? t.favorite,
        rating: rating !== undefined && rating > 0 ? rating : t.rating,
      };
    });
    return sortTracks(list, state.sortKey);
  };

  /** Updates the favorite/rating overlay and re-merges. */
  const applyUserState = (keys: string[], patch: { favorite?: boolean; rating?: number }) => {
    set((state) => {
      const cloudState: CloudUserState = {
        favorites: { ...state.cloudState.favorites },
        ratings: { ...state.cloudState.ratings },
      };
      for (const key of keys) {
        if (patch.favorite !== undefined) cloudState.favorites[key] = patch.favorite;
        if (patch.rating !== undefined) cloudState.ratings[key] = patch.rating;
      }
      return { cloudState, tracks: merged({ ...state, cloudState }) };
    });
  };

  return {
  tracks: [],
  vaultRows: [],
  pendingEdits: [],
  vaultArt: {},
  cloudState: { favorites: {}, ratings: {} },
  playlists: [],
  search: "",
  sortKey: "artist",

  loadFromDb: async () => {
    try {
      const playlists = await db.getAllPlaylists();
      set({ playlists });
    } catch (err) {
      console.error("[library] load failed:", err);
    }
  },

  setVaultRows: (vaultRows, pendingEdits) => {
    set((state) => ({ vaultRows, pendingEdits, tracks: merged({ ...state, vaultRows, pendingEdits }) }));
    // Fetch online covers this device hasn't cached yet, then re-merge.
    const missing = vaultRows
      .map((r) => r.artwork_key)
      .filter((k): k is string => Boolean(k) && !get().vaultArt[k as string]);
    if (missing.length > 0) {
      void fetchVaultArt(missing).then((found) => {
        if (Object.keys(found).length === 0) return;
        set((state) => {
          const vaultArt = { ...state.vaultArt, ...found };
          return { vaultArt, tracks: merged({ ...state, vaultArt }) };
        });
      });
    }
  },

  editTracks: (trackIds, input) => {
    if (useAuthStore.getState().status !== "signedIn") {
      throw new Error("Sign in to edit track details — they're stored online.");
    }
    const patch: TrackEditPatch = normalizeTrackPatch(input);
    if (Object.keys(patch).length === 0) return;
    const editedAt = nowIso();
    const added: PendingTrackEdit[] = [];
    for (const id of trackIds) {
      const track = get().tracks.find((t) => t.id === id);
      const ref = track && refFromTrack(track);
      if (!ref) continue; // no durable identity yet (hash still computing)
      syncEnqueue({ kind: "track.edit", track: ref, patch, editedAt });
      added.push({ keys: trackRefKeys(ref), patch, editedAt });
    }
    // Optimistic: show the edit now; the flush replaces it with the server row.
    set((state) => {
      const pendingEdits = [...state.pendingEdits, ...added];
      return { pendingEdits, tracks: merged({ ...state, pendingEdits }) };
    });
  },

  adoptVaultArt: (artworkKey, fileName) => {
    set((state) => {
      const vaultArt = { ...state.vaultArt, [artworkKey]: fileName };
      return { vaultArt, tracks: merged({ ...state, vaultArt }) };
    });
  },

  deleteFromVault: async (trackIds) => {
    const vault = vaultApi();
    if (!vault) throw new Error("The vault isn't configured on this device.");
    const targets = get().tracks.filter((t) => trackIds.includes(t.id) && t.remoteId && t.storageKey);
    const deleted = new Set<string>();
    for (const track of targets) {
      await vault.remove(track.remoteId!);
      deleted.add(track.remoteId!);
    }
    if (deleted.size === 0) return;
    // The server removed the tracks' playlist entries, favorites and history;
    // mirror that locally so nothing points at the deleted tracks.
    const goneIds = new Set(targets.map((t) => t.id));
    for (const playlist of get().playlists) {
      if (!playlist.trackIds.some((id) => goneIds.has(id))) continue;
      const kept = playlist.trackIds.filter((id) => !goneIds.has(id));
      await db.setPlaylistTracks(playlist.id, kept);
    }
    set((state) => {
      const now = nowIso();
      const vaultRows = state.vaultRows.map((r) =>
        deleted.has(r.id) ? { ...r, deleted_at: now, storage_key: null, artwork_key: null } : r,
      );
      const playlists = state.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => !goneIds.has(id)) }));
      return { vaultRows, playlists, tracks: merged({ ...state, vaultRows }) };
    });
  },

  toggleFavorite: async (id: string) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track) return;
    const favorite = !track.favorite;
    applyUserState(hashKeys(track.contentHash), { favorite });
    const ref = refFromTrack(track);
    if (ref) syncEnqueue({ kind: "favorite.set", track: ref, favorite, editedAt: nowIso() });
  },

  setSearch: (search: string) => set({ search }),

  setSortKey: (key: SortKey) => set((state) => ({ sortKey: key, tracks: sortTracks(state.tracks, key) })),

  createPlaylist: async (name: string) => {
    const playlist: Playlist = {
      id: crypto.randomUUID(),
      name,
      trackIds: [],
      createdAt: Date.now(),
    };
    await db.createPlaylist(playlist);
    set((state) => ({ playlists: [...state.playlists, playlist] }));
    syncEnqueue({
      kind: "playlist.upsert",
      playlist: playlistSnapshot(playlist),
      editedAt: nowIso(),
    });
    return playlist.id;
  },

  createSmartPlaylist: async (name: string, rules?: SmartRules) => {
    const playlist: Playlist = {
      id: crypto.randomUUID(),
      name,
      trackIds: [],
      createdAt: Date.now(),
      isSmart: true,
      smartRules: rules ?? emptySmartRules(),
    };
    await db.createPlaylist(playlist);
    set((state) => ({ playlists: [...state.playlists, playlist] }));
    syncEnqueue({
      kind: "playlist.upsert",
      playlist: playlistSnapshot(playlist),
      editedAt: nowIso(),
    });
    return playlist.id;
  },

  updateSmartRules: async (id: string, rules: SmartRules) => {
    await db.setPlaylistRules(id, rules);
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === id ? { ...p, isSmart: true, smartRules: rules } : p,
      ),
    }));
    const playlist = get().playlists.find((p) => p.id === id);
    if (playlist) {
      syncEnqueue({ kind: "playlist.upsert", playlist: playlistSnapshot(playlist), editedAt: nowIso() });
    }
  },

  renamePlaylist: async (id: string, name: string) => {
    const playlist = get().playlists.find((p) => p.id === id);
    if (!playlist) return;
    await db.renamePlaylist(id, name);
    set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, name } : p)) }));
    syncEnqueue({
      kind: "playlist.upsert",
      playlist: playlistSnapshot({ ...playlist, name }),
      editedAt: nowIso(),
    });
  },

  deletePlaylist: async (id: string) => {
    await db.deletePlaylist(id);
    set((state) => ({ playlists: state.playlists.filter((p) => p.id !== id) }));
    syncEnqueue({ kind: "playlist.delete", playlistId: id, editedAt: nowIso() });
  },

  addTrackToPlaylist: async (playlistId: string, trackId: string) => {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.trackIds.includes(trackId)) return;
    const trackIds = [...playlist.trackIds, trackId];
    await db.setPlaylistTracks(playlistId, trackIds);
    set((state) => ({
      playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, trackIds } : p)),
    }));
    const track = get().tracks.find((t) => t.id === trackId);
    const ref = track && refFromTrack(track);
    if (ref) {
      // Anchor "after the previous last track" so the position survives
      // concurrent reorders on other devices.
      const prevLast = get().tracks.find((t) => t.id === playlist.trackIds[playlist.trackIds.length - 1]);
      const prevRef = prevLast ? refFromTrack(prevLast) : null;
      syncEnqueue({
        kind: "playlistItem.add",
        playlistId,
        track: ref,
        prevTrack: prevRef ?? undefined,
        editedAt: nowIso(),
      });
    }
  },

  removeTrackFromPlaylist: async (playlistId: string, trackId: string) => {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    const trackIds = playlist.trackIds.filter((id) => id !== trackId);
    await db.setPlaylistTracks(playlistId, trackIds);
    set((state) => ({
      playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, trackIds } : p)),
    }));
    const track = get().tracks.find((t) => t.id === trackId);
    const ref = track && refFromTrack(track);
    if (ref) syncEnqueue({ kind: "playlistItem.remove", playlistId, track: ref, editedAt: nowIso() });
  },

  reorderPlaylist: async (playlistId: string, trackIds: string[]) => {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    await db.setPlaylistTracks(playlistId, trackIds);
    set((state) => ({
      playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, trackIds } : p)),
    }));
    const byId = new Map(get().tracks.map((t) => [t.id, t]));
    const refs = trackIds
      .map((id) => {
        const track = byId.get(id);
        return track ? refFromTrack(track) : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (refs.length > 0) {
      syncEnqueue({ kind: "playlist.reorder", playlistId, tracks: refs, editedAt: nowIso() });
    }
  },

  // ---- sync engine integration ------------------------------------------------

  setCloudUserState: (cloudState) => {
    set((state) => ({ cloudState, tracks: merged({ ...state, cloudState }) }));
  },

  findTrackByIdentity: (identity) => {
    const { tracks } = get();
    const byRemote = tracks.find((t) => t.remoteId === identity.remoteId);
    if (byRemote) return byRemote;
    if (identity.contentHash) {
      const hit = tracks.find((t) => t.contentHash === identity.contentHash);
      if (hit) return hit;
    }
    return undefined;
  },

  applyRemoteFavorite: async (identity, favorite) => {
    applyUserState(hashKeys(identity.contentHash), { favorite });
  },

  applyRemoteRating: async (identity, rating) => {
    applyUserState(hashKeys(identity.contentHash), { rating });
  },

  applyRemotePlaylist: async (change) => {
    if (change.isFolder) return; // folders arrive in a later phase's UI
    const existing = get().playlists.find((p) => p.id === change.id);
    if (change.deleted) {
      if (!existing) return;
      await db.deletePlaylist(change.id);
      set((state) => ({ playlists: state.playlists.filter((p) => p.id !== change.id) }));
      return;
    }
    const smartRules = (change.smartRules ?? undefined) as SmartRules | undefined;
    if (!existing) {
      const playlist: Playlist = {
        id: change.id,
        name: change.name,
        trackIds: [],
        createdAt: Date.now(),
        isSmart: change.isSmart || undefined,
        smartRules,
      };
      await db.createPlaylist(playlist);
      set((state) => ({ playlists: [...state.playlists, playlist] }));
      return;
    }
    if (existing.name !== change.name) await db.renamePlaylist(change.id, change.name);
    if (change.isSmart && smartRules) await db.setPlaylistRules(change.id, smartRules);
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === change.id
          ? { ...p, name: change.name, isSmart: change.isSmart || undefined, smartRules: smartRules ?? p.smartRules }
          : p,
      ),
    }));
  },

  applyRemotePlaylistItems: async (playlistId, trackIds) => {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    if (
      playlist.trackIds.length === trackIds.length &&
      playlist.trackIds.every((id, i) => id === trackIds[i])
    ) {
      return;
    }
    await db.setPlaylistTracks(playlistId, trackIds);
    set((state) => ({
      playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, trackIds } : p)),
    }));
  },
  };
});

function playlistSnapshot(playlist: Playlist) {
  return {
    id: playlist.id,
    parentId: null,
    name: playlist.name,
    isFolder: false,
    isSmart: Boolean(playlist.isSmart),
    smartRules: playlist.smartRules ? (JSON.parse(JSON.stringify(playlist.smartRules)) as never) : null,
    // Desktop doesn't order playlists yet; every playlist sits at the default
    // position until folder/ordering UI lands (Phase 8).
    position: "a0",
  };
}
