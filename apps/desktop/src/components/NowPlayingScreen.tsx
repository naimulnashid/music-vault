import { useEffect, useState } from "react";
import { AudioLines, ChevronDown, Heart, SlidersVertical } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import { useHistoryStore } from "../store/historyStore";
import { useUiStore } from "../store/uiStore";
import { albumKey, formatTime } from "@musicvault/core";
import { AlbumArt, Ambient } from "./AlbumArt";
import { IconButton } from "./ui/Button";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./LyricsPanel";
import { SleepTimer } from "./SleepTimer";
import type { Track } from "../types";

type Tab = "next" | "lyrics" | "details";

const TABS: { key: Tab; label: string }[] = [
  { key: "next", label: "Up next" },
  { key: "lyrics", label: "Lyrics" },
  { key: "details", label: "Details" },
];

/**
 * Full-window player that rises over the library (the player bar stays
 * below it): big artwork on a colour wash from the art, and Up next /
 * Lyrics / Details alongside.
 */
export function NowPlayingScreen() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const closeNowPlaying = useUiStore((s) => s.closeNowPlaying);
  const showArtist = useUiStore((s) => s.showArtist);
  const showAlbum = useUiStore((s) => s.showAlbum);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const isFavorite = useLibraryStore((s) =>
    currentTrack ? Boolean(s.tracks.find((t) => t.id === currentTrack.id)?.favorite) : false,
  );
  const activePanel = useUiStore((s) => s.activePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const [tab, setTab] = useState<Tab>("next");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea")) closeNowPlaying();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeNowPlaying]);

  // The song can end with an empty queue while the screen is open.
  useEffect(() => {
    if (!currentTrack) closeNowPlaying();
  }, [currentTrack, closeNowPlaying]);

  if (!currentTrack) return null;

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      className="absolute inset-0 z-20 bg-bg overflow-hidden flex flex-col"
    >
      <Ambient track={currentTrack} strength={0.75} />

      <div className="relative h-14 shrink-0 flex items-center px-3 md:px-5">
        <IconButton label="Close player" size="md" onClick={closeNowPlaying}>
          <ChevronDown className="w-6 h-6" />
        </IconButton>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col lg:flex-row gap-6 lg:gap-12 px-6 md:px-10 xl:px-16 pb-6 overflow-y-auto lg:overflow-hidden">
        {/* Artwork + title. Below lg the page scrolls, so this keeps its height instead of sliding under Up next. */}
        <div className="flex-none lg:flex-1 min-w-0 lg:min-h-0 flex flex-col items-center justify-center gap-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentTrack.id}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="w-full flex justify-center"
            >
              <AlbumArt
                track={currentTrack}
                className="w-[min(100%,52vh,560px)] aspect-square rounded-2xl object-cover shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)]"
              />
            </motion.div>
          </AnimatePresence>
          <div className="w-[min(100%,52vh,560px)] flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <motion.h1
                key={`t-${currentTrack.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl xl:text-3xl font-bold truncate"
              >
                {currentTrack.title}
              </motion.h1>
              <div className="text-base text-muted truncate mt-1">
                <button onClick={() => showArtist(currentTrack.artist)} className="hover:text-fg hover:underline">
                  {currentTrack.artist}
                </button>
                {currentTrack.album && (
                  <>
                    <span className="mx-2 text-subtle">•</span>
                    <button
                      onClick={() => showAlbum(albumKey(currentTrack))}
                      className="hover:text-fg hover:underline"
                    >
                      {currentTrack.album}
                    </button>
                  </>
                )}
              </div>
            </div>
            <IconButton
              label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              size="md"
              onClick={() => void toggleFavorite(currentTrack.id)}
              className={isFavorite ? "text-accent! hover:text-accent!" : ""}
            >
              <Heart key={String(isFavorite)} className={`w-6 h-6 ${isFavorite ? "fill-current animate-pop" : ""}`} />
            </IconButton>
          </div>
          {/* The player bar drops these below md; the full player keeps them reachable. */}
          <div className="md:hidden w-[min(100%,52vh,560px)] flex items-center justify-center gap-6">
            <SleepTimer />
            <IconButton label="Visualizer" size="md" active={activePanel === "visualizer"} onClick={() => togglePanel("visualizer")}>
              <AudioLines className="w-5 h-5" />
            </IconButton>
            <IconButton label="Sound" size="md" active={activePanel === "equalizer"} onClick={() => togglePanel("equalizer")}>
              <SlidersVertical className="w-5 h-5" />
            </IconButton>
          </div>
        </div>

        {/* Up next / Lyrics / Details */}
        <div className="lg:w-[400px] xl:w-[440px] shrink-0 min-h-[420px] lg:min-h-0 flex flex-col rounded-2xl bg-surface/55 backdrop-blur-xl border border-line overflow-hidden">
          <div className="flex shrink-0 px-2 pt-2 relative">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative flex-1 h-11 text-sm font-semibold transition-colors ${
                  tab === t.key ? "text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {t.label}
                {tab === t.key && (
                  <motion.span
                    layoutId="np-tab"
                    className="absolute left-4 right-4 bottom-0 h-0.5 rounded-full bg-accent"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="h-px bg-line shrink-0" />
          <div className="flex-1 min-h-0 pt-2">
            {tab === "next" && <QueuePanel variant="stage" />}
            {tab === "lyrics" && <LyricsPanel variant="stage" />}
            {tab === "details" && <TrackDetails track={currentTrack} />}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function TrackDetails({ track }: { track: Track }) {
  const plays = useHistoryStore((s) => s.playCounts[track.id] ?? 0);
  const rows: [string, string | undefined][] = [
    ["Title", track.title],
    ["Artist", track.artist],
    ["Album", track.album],
    ["Genre", track.genre],
    ["Language", track.language],
    ["Country", track.country],
    ["Released", track.releaseDate],
    ["Length", formatTime(track.duration)],
    ["Format", [track.codec, track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : undefined, track.bitDepth ? `${track.bitDepth}-bit` : undefined].filter(Boolean).join(" · ") || undefined],
    ["Size", track.fileSize ? `${(track.fileSize / 1024 / 1024).toFixed(1)} MB` : undefined],
    ["Plays", String(plays)],
  ];
  return (
    <div className="h-full overflow-y-auto px-5 py-3 select-text">
      <dl className="divide-y divide-line">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex gap-4 py-3 text-sm">
              <dt className="w-24 shrink-0 text-muted">{k}</dt>
              <dd className="flex-1 min-w-0 font-medium break-words">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
