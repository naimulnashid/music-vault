"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { smartDef } from "@musicvault/core";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { LibraryView } from "./LibraryView";
import { AlbumGrid } from "./AlbumGrid";
import { AlbumPage } from "./AlbumPage";
import { ArtistPage } from "./ArtistPage";
import { PlaylistView } from "./PlaylistView";
import { SmartPlaylistView } from "./SmartPlaylistView";
import { GroupedBrowseView } from "./GroupedBrowseView";
import { SearchView } from "./SearchView";
import { NowPlayingBar } from "./NowPlayingBar";
import { NowPlayingScreen } from "./NowPlayingScreen";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./LyricsPanel";
import { ErrorToast } from "./ErrorToast";
import { UploadDialog } from "./UploadDialog";
import { TrackEditor } from "./TrackEditor";
import { useUploadStore } from "../store/uploadStore";
import { filesFromDrop } from "../lib/uploadPrepare";

// Heavy, rarely-first views load on demand — they carry chart rendering
// (stats/recap), Web Audio analyser canvas work (visualizer/EQ) or download
// management no one hits on a cold start.
const StatsView = lazy(() => import("./StatsView").then((m) => ({ default: m.StatsView })));
const RecapView = lazy(() => import("./RecapView").then((m) => ({ default: m.RecapView })));
const HeatmapView = lazy(() => import("./Heatmap").then((m) => ({ default: m.HeatmapView })));
const DownloadsView = lazy(() => import("./DownloadsView").then((m) => ({ default: m.DownloadsView })));
const EqualizerPanel = lazy(() => import("./EqualizerPanel").then((m) => ({ default: m.EqualizerPanel })));
const Visualizer = lazy(() => import("./Visualizer").then((m) => ({ default: m.Visualizer })));
import { useAudioEngine } from "../hooks/useAudioEngine";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useMediaSession } from "../hooks/useMediaSession";
import { useNotifications } from "../hooks/useNotifications";
import { useTheme } from "../hooks/useTheme";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { useSettingsStore } from "../store/settingsStore";
import { usePlayerStore } from "../store/playerStore";
import { useUiStore } from "../store/uiStore";
import { useDownloadStore } from "../store/downloadStore";
import { startUrlSync } from "../lib/urlSync";
import { startPwa } from "../lib/pwa";
import { loadLastPlayback } from "../lib/lastPlayback";
import { freshStartOnce } from "../lib/freshStart";
// Side-effect import: subscribes the sync engine to auth state changes.
import "../store/syncStore";

export default function MusicVaultApp() {
  const init = useAuthStore((s) => s.init);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const mainView = useUiStore((s) => s.mainView);
  const smartKey = useUiStore((s) => s.smartKey);
  const activePlaylistId = useUiStore((s) => s.activePlaylistId);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const activeAlbumKey = useUiStore((s) => s.activeAlbumKey);
  const activeArtist = useUiStore((s) => s.activeArtist);
  const activePanel = useUiStore((s) => s.activePanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const nowPlayingExpanded = useUiStore((s) => s.nowPlayingExpanded);

  useAudioEngine();
  useKeyboardShortcuts();
  useMediaSession();
  useNotifications();
  useTheme();

  useEffect(() => {
    startUrlSync();
    startPwa();
    void (async () => {
      // One-time clean slate for the rebuilt library; reload so nothing stale lingers.
      if (await freshStartOnce()) {
        window.location.reload();
        return;
      }
      init();
      void loadSettings();
      void useDownloadStore.getState().init();
    })();
  }, [init, loadSettings]);

  // Resume where the last session left off once the library is hydrated.
  const restoredRef = useRef(false);
  const trackCount = useLibraryStore((s) => s.tracks.length);
  useEffect(() => {
    if (restoredRef.current) return;
    const tracks = useLibraryStore.getState().tracks;
    if (tracks.length === 0) return;
    restoredRef.current = true;
    const saved = loadLastPlayback();
    if (!saved) return;
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

  // Dropping music files or folders onto the page opens the upload dialog
  // (nothing uploads until confirmed). Only when signed in.
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="h-[100dvh] flex flex-col bg-bg text-fg overflow-hidden"
        onDragEnter={(e) => {
          if (!signedIn || !hasFiles(e)) return;
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(e) => {
          if (signedIn && hasFiles(e)) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={(e) => {
          if (!signedIn || !hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          void filesFromDrop(e.dataTransfer).then((files) => useUploadStore.getState().openWith(files));
        }}
      >
        {/* Drop-target overlay while dragging audio files/folders in */}
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
                <p className="text-lg font-bold">Drop to upload to your vault</p>
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
                <Suspense fallback={null}>
                  {mainView === "tracks" && <LibraryView />}
                  {mainView === "albums" && <AlbumGrid />}
                  {mainView === "album" && <AlbumPage />}
                  {mainView === "artist" && <ArtistPage />}
                  {mainView === "stats" && <StatsView />}
                  {mainView === "recap" && <RecapView />}
                  {mainView === "heatmap" && <HeatmapView />}
                  {mainView === "downloads" && <DownloadsView />}
                  {mainView === "playlist" && <PlaylistView />}
                  {mainView === "search" && <SearchView />}
                  {mainView === "smart" && smartKey && smartIsGroup && <GroupedBrowseView smartKey={smartKey} />}
                  {mainView === "smart" && smartKey && !smartIsGroup && <SmartPlaylistView smartKey={smartKey} />}
                </Suspense>
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
                    <Suspense fallback={null}>
                      {activePanel === "queue" && <QueuePanel />}
                      {activePanel === "equalizer" && <EqualizerPanel />}
                      {activePanel === "lyrics" && <LyricsPanel />}
                      {activePanel === "visualizer" && <Visualizer />}
                    </Suspense>
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
