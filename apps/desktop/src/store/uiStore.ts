import { create } from "zustand";
import type { SmartKey } from "@musicvault/core";

export type PanelKey = "queue" | "equalizer" | "lyrics" | "visualizer" | null;
export type MainView =
  | "tracks"
  | "albums"
  | "playlist"
  | "smart"
  | "stats"
  | "recap"
  | "heatmap"
  | "album"
  | "artist"
  | "downloads"
  | "settings"
  | "search";

/** Where the main area is: one entry of the back stack. */
export interface Location {
  mainView: MainView;
  activePlaylistId: string | null;
  smartKey: SmartKey | null;
  /** Drill-in inside a grouped smart view ("By Genre" → "Rock"). */
  activeGroup: string | null;
  activeAlbumKey: string | null;
  activeArtist: string | null;
}

export const HOME: Location = {
  mainView: "tracks",
  activePlaylistId: null,
  smartKey: null,
  activeGroup: null,
  activeAlbumKey: null,
  activeArtist: null,
};

const SIDEBAR_KEY = "mv.sidebarCollapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

interface UiState extends Location {
  activePanel: PanelKey;
  togglePanel: (panel: PanelKey) => void;
  closePanel: () => void;
  /** Mobile drawer. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Desktop: icon-only rail instead of the full sidebar. */
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  nowPlayingExpanded: boolean;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
  toggleNowPlaying: () => void;
  /** Previous locations, most recent last. */
  history: Location[];
  canGoBack: boolean;
  goBack: () => void;
  showTracks: () => void;
  showAlbums: () => void;
  showSmart: (key: SmartKey) => void;
  showGroup: (key: SmartKey, group: string) => void;
  showPlaylist: (id: string) => void;
  showStats: () => void;
  showRecap: () => void;
  /** All-time listening heatmap (expanded from Statistics). */
  showHeatmap: () => void;
  showDownloads: () => void;
  showSettings: () => void;
  showAlbum: (key: string) => void;
  showArtist: (name: string) => void;
  showSearch: () => void;
  /** Tracks open in the details editor (null = closed). */
  editorTrackIds: string[] | null;
  openEditor: (trackIds: string[]) => void;
  closeEditor: () => void;
}

const locationOf = (s: Location): Location => ({
  mainView: s.mainView,
  activePlaylistId: s.activePlaylistId,
  smartKey: s.smartKey,
  activeGroup: s.activeGroup,
  activeAlbumKey: s.activeAlbumKey,
  activeArtist: s.activeArtist,
});

const sameLocation = (a: Location, b: Location) =>
  a.mainView === b.mainView &&
  a.activePlaylistId === b.activePlaylistId &&
  a.smartKey === b.smartKey &&
  a.activeGroup === b.activeGroup &&
  a.activeAlbumKey === b.activeAlbumKey &&
  a.activeArtist === b.activeArtist;

export const useUiStore = create<UiState>((set, get) => {
  /** Moves to a new location, remembering the current one for Back. */
  const go = (patch: Partial<Location>) => {
    const current = locationOf(get());
    const next: Location = { ...HOME, ...patch };
    if (sameLocation(current, next)) {
      set({ sidebarOpen: false, nowPlayingExpanded: false });
      return;
    }
    const history = [...get().history, current].slice(-50);
    set({ ...next, history, canGoBack: history.length > 0, sidebarOpen: false, nowPlayingExpanded: false });
  };

  return {
    ...HOME,
    activePanel: null,
    togglePanel: (panel) => set({ activePanel: get().activePanel === panel ? null : panel }),
    closePanel: () => set({ activePanel: null }),
    sidebarOpen: false,
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
    sidebarCollapsed: loadCollapsed(),
    toggleSidebarCollapsed: () => {
      const sidebarCollapsed = !get().sidebarCollapsed;
      try {
        localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0");
      } catch {
        // storage unavailable: the choice just doesn't persist
      }
      set({ sidebarCollapsed });
    },
    nowPlayingExpanded: false,
    openNowPlaying: () => set({ nowPlayingExpanded: true }),
    closeNowPlaying: () => set({ nowPlayingExpanded: false }),
    toggleNowPlaying: () => set({ nowPlayingExpanded: !get().nowPlayingExpanded }),
    history: [],
    canGoBack: false,
    goBack: () => {
      const history = [...get().history];
      const prev = history.pop();
      if (!prev) return;
      set({ ...prev, history, canGoBack: history.length > 0, nowPlayingExpanded: false });
    },
    showTracks: () => go({ mainView: "tracks" }),
    showAlbums: () => go({ mainView: "albums" }),
    showSmart: (key) => go({ mainView: "smart", smartKey: key }),
    showGroup: (key, group) => go({ mainView: "smart", smartKey: key, activeGroup: group }),
    showPlaylist: (id) => go({ mainView: "playlist", activePlaylistId: id }),
    showStats: () => go({ mainView: "stats" }),
    showRecap: () => go({ mainView: "recap" }),
    showHeatmap: () => go({ mainView: "heatmap" }),
    showDownloads: () => go({ mainView: "downloads" }),
    showSettings: () => go({ mainView: "settings" }),
    showAlbum: (key) => go({ mainView: "album", activeAlbumKey: key }),
    showArtist: (name) => go({ mainView: "artist", activeArtist: name }),
    showSearch: () => {
      if (get().mainView !== "search") go({ mainView: "search" });
    },
    editorTrackIds: null,
    openEditor: (trackIds) => set({ editorTrackIds: trackIds.length > 0 ? trackIds : null }),
    closeEditor: () => set({ editorTrackIds: null }),
  };
});
