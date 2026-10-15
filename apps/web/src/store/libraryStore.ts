import { create } from "zustand";
import {
  emptySmartRules,
  normalizeTrackPatch,
  type PlaylistChange,
  type SmartRules,
  type TrackIdentity,
} from "@musicvault/core";
import type { Playlist, Track } from "../types";
import { nowIso, refFromTrack, syncEnqueue } from "../lib/syncBus";
import { applyPatchToTrack } from "../lib/trackMap";
import { registerArtworkKeys } from "../lib/artwork";
import { removeAudio } from "../lib/audioCache";
import { vaultApi } from "../lib/vault";
import { useAuthStore } from "./authStore";

export type SortKey = "title" | "artist" | "album";

interface LibraryState {
  /** The library: vault tracks from the synced rows, with user/cache flags. */
  tracks: Track[];
  /** Tracks projected from the sync shadow (canonical Supabase rows). */
  cloudTracks: Track[];
  playlists: Playlist[];
  search: string;
  sortKey: SortKey;
  /** True once the sync store hydrated the library from the local shadow. */
  hydrated: boolean;
  /** Bulk replace from hydration (tracks already carry favorite/rating). */
  setLibrary: (tracks: Track[], playlists: Playlist[]) => void;
  /** Metadata refresh: replaces track rows but keeps favorite/rating/cache flags. */
  mergeTracks: (tracks: Track[]) => void;
  /** Marks which tracks have local audio (cache/download bookkeeping). */
  setAudioFlags: (flags: Map<string, { cached: boolean; pinned: boolean }>) => void;
  toggleFavorite: (id: string) => void;
  setSearch: (search: string) => void;
  setSortKey: (key: SortKey) => void;
  createPlaylist: (name: string) => string;
  createSmartPlaylist: (name: string, rules?: SmartRules) => string;
  updateSmartRules: (id: string, rules: SmartRules) => void;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  reorderPlaylist: (playlistId: string, trackIds: string[]) => void;
  /**
   * Edits metadata online (track.edit, field-level LWW) for one or more
   * tracks. Throws a TrackEditError for invalid input, or when signed out.
   */
  editTracks: (trackIds: string[], patch: Record<string, unknown>) => void;
  /** "Delete from vault": removes the audio and the track's history online. */
  deleteFromVault: (trackIds: string[]) => Promise<void>;

  // ---- sync engine integration (no re-enqueue: remote is authoritative) ----
  findTrackByIdentity: (identity: TrackIdentity) => Track | undefined;
  applyRemoteFavorite: (identity: TrackIdentity, favorite: boolean) => void;
  applyRemoteRating: (identity: TrackIdentity, rating: number) => void;
  applyRemotePlaylist: (change: PlaylistChange) => void;
  applyRemotePlaylistItems: (playlistId: string, trackIds: string[]) => void;
}

function sortTracks(tracks: Track[], key: SortKey): Track[] {
  return [...tracks].sort((a, b) => a[key].localeCompare(b[key]) || a.title.localeCompare(b.title));
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  const patchTrack = (id: string, patch: Partial<Track>) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  /**
   * Recomputes the track list from the synced rows, carrying user/cache flags
   * over from the previous state.
   */
  const merged = (state: Pick<LibraryState, "cloudTracks" | "sortKey" | "tracks">): Track[] => {
    const prevById = new Map(state.tracks.map((t) => [t.id, t]));
    const list = state.cloudTracks.map((t) => {
      const old = prevById.get(t.id);
      if (!old) return t;
      return {
        ...t,
        favorite: t.favorite ?? old.favorite,
        rating: t.rating ?? old.rating,
        cached: old.cached,
        pinned: old.pinned,
      };
    });
    registerArtworkKeys(list);
    return sortTracks(list, state.sortKey);
  };

  return {
    tracks: [],
    cloudTracks: [],
    playlists: [],
    search: "",
    sortKey: "artist",
    hydrated: false,

    setLibrary: (cloudTracks, playlists) => {
      set((state) => ({
        cloudTracks,
        playlists,
        hydrated: true,
        tracks: merged({ ...state, cloudTracks }),
      }));
    },

    mergeTracks: (cloudTracks) => {
      set((state) => ({ cloudTracks, tracks: merged({ ...state, cloudTracks }) }));
    },

    setAudioFlags: (flags) => {
      set((state) => ({
        tracks: state.tracks.map((t) => {
          const f = flags.get(t.id);
          const cached = f?.cached ?? false;
          const pinned = f?.pinned ?? false;
          return t.cached === cached && t.pinned === pinned ? t : { ...t, cached, pinned };
        }),
      }));
    },

    toggleFavorite: (id) => {
      const track = get().tracks.find((t) => t.id === id);
      if (!track) return;
      const favorite = !track.favorite;
      patchTrack(id, { favorite });
      const ref = refFromTrack(track);
      if (ref) syncEnqueue({ kind: "favorite.set", track: ref, favorite, editedAt: nowIso() });
    },

    setSearch: (search) => set({ search }),

    setSortKey: (key) => set((state) => ({ sortKey: key, tracks: sortTracks(state.tracks, key) })),

    createPlaylist: (name) => {
      const playlist: Playlist = {
        id: crypto.randomUUID(),
        name,
        trackIds: [],
        createdAt: Date.now(),
      };
      set((state) => ({ playlists: [...state.playlists, playlist] }));
      syncEnqueue({ kind: "playlist.upsert", playlist: playlistSnapshot(playlist), editedAt: nowIso() });
      return playlist.id;
    },

    createSmartPlaylist: (name, rules) => {
      const playlist: Playlist = {
        id: crypto.randomUUID(),
        name,
        trackIds: [],
        createdAt: Date.now(),
        isSmart: true,
        smartRules: rules ?? emptySmartRules(),
      };
      set((state) => ({ playlists: [...state.playlists, playlist] }));
      syncEnqueue({ kind: "playlist.upsert", playlist: playlistSnapshot(playlist), editedAt: nowIso() });
      return playlist.id;
    },

    updateSmartRules: (id, rules) => {
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === id ? { ...p, isSmart: true, smartRules: rules } : p)),
      }));
      const playlist = get().playlists.find((p) => p.id === id);
      if (playlist) {
        syncEnqueue({ kind: "playlist.upsert", playlist: playlistSnapshot(playlist), editedAt: nowIso() });
      }
    },

    renamePlaylist: (id, name) => {
      const playlist = get().playlists.find((p) => p.id === id);
      if (!playlist) return;
      set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, name } : p)) }));
      syncEnqueue({
        kind: "playlist.upsert",
        playlist: playlistSnapshot({ ...playlist, name }),
        editedAt: nowIso(),
      });
    },

    deletePlaylist: (id) => {
      set((state) => ({ playlists: state.playlists.filter((p) => p.id !== id) }));
      syncEnqueue({ kind: "playlist.delete", playlistId: id, editedAt: nowIso() });
    },

    addTrackToPlaylist: (playlistId, trackId) => {
      const playlist = get().playlists.find((p) => p.id === playlistId);
      if (!playlist || playlist.trackIds.includes(trackId)) return;
      const trackIds = [...playlist.trackIds, trackId];
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

    removeTrackFromPlaylist: (playlistId, trackId) => {
      const playlist = get().playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      const trackIds = playlist.trackIds.filter((id) => id !== trackId);
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, trackIds } : p)),
      }));
      const track = get().tracks.find((t) => t.id === trackId);
      const ref = track && refFromTrack(track);
      if (ref) syncEnqueue({ kind: "playlistItem.remove", playlistId, track: ref, editedAt: nowIso() });
    },

    reorderPlaylist: (playlistId, trackIds) => {
      const playlist = get().playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
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

    editTracks: (trackIds, input) => {
      if (useAuthStore.getState().status !== "signedIn") {
        throw new Error("Sign in to edit track details — they're stored online.");
      }
      const patch = normalizeTrackPatch(input);
      if (Object.keys(patch).length === 0) return;
      const editedAt = nowIso();
      const ids = new Set(trackIds);
      for (const id of trackIds) {
        const track = get().tracks.find((t) => t.id === id);
        const ref = track && refFromTrack(track);
        if (ref) syncEnqueue({ kind: "track.edit", track: ref, patch, editedAt });
      }
      // Optimistic: show it now; the flush brings back the server's row.
      set((state) => {
        const cloudTracks = state.cloudTracks.map((t) => (ids.has(t.id) ? applyPatchToTrack(t, patch) : t));
        const tracks = state.tracks.map((t) => (ids.has(t.id) ? applyPatchToTrack(t, patch) : t));
        registerArtworkKeys(tracks);
        return { cloudTracks, tracks: sortTracks(tracks, state.sortKey) };
      });
    },

    deleteFromVault: async (trackIds) => {
      const vault = vaultApi();
      if (!vault) throw new Error("The vault isn't configured for this site.");
      const targets = get().tracks.filter((t) => trackIds.includes(t.id) && t.storageKey);
      const gone = new Set<string>();
      for (const track of targets) {
        await vault.remove(track.id);
        gone.add(track.id);
        await removeAudio(track.id).catch(() => {});
      }
      if (gone.size === 0) return;
      // The server removed their playlist entries, favorites and history too.
      set((state) => ({
        cloudTracks: state.cloudTracks.filter((t) => !gone.has(t.id)),
        tracks: state.tracks.filter((t) => !gone.has(t.id)),
        playlists: state.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => !gone.has(id)) })),
      }));
    },

    // ---- sync engine integration ------------------------------------------------

    findTrackByIdentity: (identity) => {
      const { tracks } = get();
      const byId = tracks.find((t) => t.id === identity.remoteId);
      if (byId) return byId;
      if (identity.contentHash) {
        const hit = tracks.find((t) => t.contentHash === identity.contentHash);
        if (hit) return hit;
      }
      return undefined;
    },

    applyRemoteFavorite: (identity, favorite) => {
      const track = get().findTrackByIdentity(identity);
      if (track) patchTrack(track.id, { favorite });
    },

    applyRemoteRating: (identity, rating) => {
      const track = get().findTrackByIdentity(identity);
      if (track) patchTrack(track.id, { rating: rating > 0 ? rating : undefined });
    },

    applyRemotePlaylist: (change) => {
      if (change.isFolder) return; // folders arrive in a later phase's UI
      const existing = get().playlists.find((p) => p.id === change.id);
      if (change.deleted) {
        if (!existing) return;
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
        set((state) => ({ playlists: [...state.playlists, playlist] }));
        return;
      }
      set((state) => ({
        playlists: state.playlists.map((p) =>
          p.id === change.id
            ? { ...p, name: change.name, isSmart: change.isSmart || undefined, smartRules: smartRules ?? p.smartRules }
            : p,
        ),
      }));
    },

    applyRemotePlaylistItems: (playlistId, trackIds) => {
      const playlist = get().playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      if (playlist.trackIds.length === trackIds.length && playlist.trackIds.every((id, i) => id === trackIds[i])) {
        return;
      }
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
    // Playlist ordering UI is deferred (matches desktop) — default position.
    position: "a0",
  };
}
