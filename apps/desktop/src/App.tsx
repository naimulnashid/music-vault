import { useEffect, useRef } from "react";
import { UploadCloud } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { TopBar } from "./components/TopBar";
import { SearchView } from "./components/SearchView";
import { NowPlayingScreen } from "./components/NowPlayingScreen";
import { Sidebar } from "./components/Sidebar";
import { LibraryView } from "./components/LibraryView";
import { AlbumGrid } from "./components/AlbumGrid";
import { AlbumPage } from "./components/AlbumPage";
import { ArtistPage } from "./components/ArtistPage";
import { StatsView } from "./components/StatsView";
import { RecapView } from "./components/RecapView";
import { HeatmapView } from "./components/Heatmap";
import { DownloadsView } from "./components/DownloadsView";
import { SettingsView } from "./components/SettingsView";
import { PlaylistView } from "./components/PlaylistView";
import { SmartPlaylistView } from "./components/SmartPlaylistView";
import { GroupedBrowseView } from "./components/GroupedBrowseView";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { QueuePanel } from "./components/QueuePanel";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { LyricsPanel } from "./components/LyricsPanel";
import { Visualizer } from "./components/Visualizer";
import { ErrorToast } from "./components/ErrorToast";
import { UploadDialog } from "./components/UploadDialog";
import { TrackEditor } from "./components/TrackEditor";
import { useAuthStore } from "./store/authStore";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useMiniBridge } from "./hooks/useMiniBridge";
import { useTheme } from "./hooks/useTheme";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useZoom } from "./hooks/useZoom";
import { useSmtc } from "./hooks/useSmtc";
import { useNotifications } from "./hooks/useNotifications";
import { useFileDrop } from "./hooks/useFileDrop";
import { useLibraryStore } from "./store/libraryStore";
import { useSettingsStore } from "./store/settingsStore";
import { usePlayerStore } from "./store/playerStore";
import { useUiStore } from "./store/uiStore";
import { smartDef } from "@musicvault/core";
import { loadLastPlayback } from "./lib/lastPlayback";

function App() {
  const loadFromDb = useLibraryStore((s) => s.loadFromDb);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const mainView = useUiStore((s) => s.mainView);
  const smartKey = useUiStore((s) => s.smartKey);
  const activePanel = useUiStore((s) => s.activePanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const nowPlayingExpanded = useUiStore((s) => s.nowPlayingExpanded);
  const activePlaylistId = useUiStore((s) => s.activePlaylistId);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const activeAlbumKey = useUiStore((s) => s.activeAlbumKey);
  const activeArtist = useUiStore((s) => s.activeArtist);
  const signedIn = useAuthStore((s) => s.status === "signedIn");

  useAudioEngine();
  useTheme();
  useMiniBridge();
  useKeyboardShortcuts();
  useZoom();
  useSmtc();
  useNotifications();
  const dragOver = useFileDrop();

  useEffect(() => {
    void loadFromDb().then(() => {
      // Startup profile, third mark (after Rust "setup done" and the
      // renderer's "first render"): the library is on screen.
      performance.mark("mv:library-loaded");
      console.info(
        `[startup] library loaded at ${Math.round(performance.now())}ms (${useLibraryStore.getState().tracks.length} tracks)`,
      );
    });
    void loadSettings();
  }, [loadFromDb, loadSettings]);

  const restoredRef = useRef(false);
  const trackCount = useLibraryStore((s) => s.tracks.length);
  useEffect(() => {
    if (restoredRef.current) return;
    const tracks = useLibraryStore.getState().tracks;
    if (tracks.length === 0) return;
    restoredRef.current = true;
    const saved = loadLastPlayback();
    // A queue handed off from another device may already be loaded.
    if (!saved || usePlayerStore.getState().queue.length > 0) return;
    const track = tracks.find((t) => t.id === saved.trackId);
    if (track) usePlayerStore.getState().restoreTrack(track, saved.time);
  }, [trackCount]);

  // The queue panel closes on a click anywhere outside it (its own toggle
  // button excluded, which toggles it itself).
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (activePanel !== "queue") return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || panelRef.current?.contains(target)) return;
      if (target.closest("[data-queue-toggle]")) return;
      closePanel();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [activePanel, closePanel]);

  const smartIsGroup = mainView === "smart" && smartKey && smartDef(smartKey).kind === "group";
  const viewKey = [mainView, activePlaylistId, smartKey, activeGroup, activeAlbumKey, activeArtist].join("|");

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-screen flex flex-col bg-bg text-fg overflow-hidden">
        {/* Drop-target overlay while dragging audio files/folders from the OS */}
        <AnimatePresence>
          {dragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[95] flex items-center justify-center bg-scrim backdrop-blur-sm pointer-events-none"
            >
              <motion.div
                initial={{ scale: 0.92 }}
                animate={{ scale: 1 }}
                className="flex flex-col items-center gap-4 px-14 py-12 rounded-3xl border-2 border-dashed border-accent bg-surface/80 text-fg"
              >
                <UploadCloud className="w-12 h-12 text-accent" />
                <p className="text-lg font-bold">{signedIn ? "Drop to upload to your vault" : "Sign in to upload music"}</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Everything above the player bar; Now Playing rises over this area. */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <TopBar />
          <div className="relative flex-1 min-h-0 flex">
            {/* Mobile: slide-over drawer */}
            <AnimatePresence>
              {sidebarOpen && (
                <>
                  <motion.div
                    key="scrim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-scrim z-40 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                  />
                  <motion.div
                    key="drawer"
                    initial={{ x: "-100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "-100%" }}
                    transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                    className="fixed inset-y-0 left-0 z-50 md:hidden shadow-2xl"
                  >
                    <Sidebar />
                  </motion.div>
                </>
              )}
            </AnimatePresence>
            {/* Desktop: static column, full or icon rail */}
            <div className="hidden md:block shrink-0">
              <Sidebar collapsed={sidebarCollapsed} />
            </div>

            <main className="relative flex-1 min-w-0">
              <motion.div
                key={viewKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="h-full"
              >
                {mainView === "tracks" && <LibraryView />}
                {mainView === "albums" && <AlbumGrid />}
                {mainView === "album" && <AlbumPage />}
                {mainView === "artist" && <ArtistPage />}
                {mainView === "stats" && <StatsView />}
                {mainView === "recap" && <RecapView />}
                {mainView === "heatmap" && <HeatmapView />}
                {mainView === "downloads" && <DownloadsView />}
                {mainView === "settings" && <SettingsView />}
                {mainView === "playlist" && <PlaylistView />}
                {mainView === "search" && <SearchView />}
                {mainView === "smart" && smartKey && smartIsGroup && <GroupedBrowseView smartKey={smartKey} />}
                {mainView === "smart" && smartKey && !smartIsGroup && <SmartPlaylistView smartKey={smartKey} />}
              </motion.div>
            </main>

            {/* Side panels float over the content's right edge. */}
            <AnimatePresence>
              {activePanel && (
                <>
                  <motion.div
                    key="panel-scrim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-scrim z-30 md:hidden"
                    onClick={closePanel}
                  />
                  <motion.aside
                    ref={panelRef}
                    key="panel"
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="fixed md:absolute z-40 md:z-10 inset-y-0 right-0 md:top-0 md:bottom-3 md:right-3 w-full max-w-sm md:w-[380px] bg-surface md:rounded-2xl border-l md:border border-line shadow-[0_20px_60px_-15px_rgb(0_0_0/0.6)] overflow-hidden"
                  >
                    {activePanel === "queue" && <QueuePanel />}
                    {activePanel === "equalizer" && <EqualizerPanel />}
                    {activePanel === "lyrics" && <LyricsPanel />}
                    {activePanel === "visualizer" && <Visualizer />}
                  </motion.aside>
                </>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>{nowPlayingExpanded && <NowPlayingScreen key="np" />}</AnimatePresence>
        </div>

        <NowPlayingBar />
        <ErrorToast />
        <UploadDialog />
        <TrackEditor />
      </div>
    </MotionConfig>
  );
}

export default App;
