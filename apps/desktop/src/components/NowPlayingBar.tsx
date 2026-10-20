import { useRef, type MouseEvent } from "react";
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Heart,
  BrushCleaning,
  ListMusic,
  MicVocal,
  MoreVertical,
  PictureInPicture2,
  SlidersVertical,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { motion } from "motion/react";
import { miniToggle } from "../lib/miniBridge";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import { useAwaitingAudio, useTrackDownload } from "../lib/trackState";
import { useUiStore } from "../store/uiStore";
import { seekAudio } from "../hooks/useAudioEngine";
import { albumKey, formatTime } from "@musicvault/core";
import { AlbumArt } from "./AlbumArt";
import { SleepTimer } from "./SleepTimer";
import { IconButton } from "./ui/Button";
import { Slider } from "./ui/Slider";
import { anchorFromElement } from "./ui/Menu";
import { useTrackMenu } from "./TrackMenu";
import { PlayPauseButton, RepeatButton, ShuffleButton, VolumeControl } from "./PlayerControls";

/**
 * The bottom player: a seek line along its top edge, the song on the left,
 * transport in the middle, sound/panels on the right.
 */
export function NowPlayingBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const queueEmpty = usePlayerStore((s) => s.queue.length === 0);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const isFavorite = useLibraryStore((s) =>
    currentTrack ? Boolean(s.tracks.find((t) => t.id === currentTrack.id)?.favorite) : false,
  );

  const activePanel = useUiStore((s) => s.activePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const nowPlayingExpanded = useUiStore((s) => s.nowPlayingExpanded);
  const toggleNowPlaying = useUiStore((s) => s.toggleNowPlaying);
  const showArtist = useUiStore((s) => s.showArtist);
  const showAlbum = useUiStore((s) => s.showAlbum);
  const { openMenu, menu } = useTrackMenu();
  const moreRef = useRef<HTMLButtonElement>(null);

  const disabled = !currentTrack;

  /** A click on the bar itself (not a control, the seek line or a menu) opens the full player. */
  const onBarClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!currentTrack || !e.currentTarget.contains(target)) return; // menus render in portals
    if (target.closest("button, a, input, select, [role='slider'], [role='menu'], [role='dialog'], [data-no-expand]")) return;
    toggleNowPlaying();
  };

  return (
    <div
      onClick={onBarClick}
      className={`relative shrink-0 h-[72px] md:h-20 z-30 bg-surface/85 backdrop-blur-2xl border-t border-line ${currentTrack ? "cursor-pointer" : ""}`}
    >
      {/* Seek line along the top edge; grows when hovered. */}
      <div className="absolute -top-2 inset-x-0" data-no-expand>
        <Slider
          label="Seek"
          value={Math.min(currentTime, duration || 0)}
          max={duration || 0}
          onChange={(v) => seekAudio(v)}
          commitOnRelease
          formatTooltip={formatTime}
          disabled={disabled}
          thickness={3}
        />
      </div>

      <div className="h-full flex items-center gap-3 px-3 md:px-4">
        {/* Song */}
        <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-none md:w-[30%]">
          <button
            onClick={() => currentTrack && toggleNowPlaying()}
            disabled={disabled}
            title={nowPlayingExpanded ? "Close player" : "Open player"}
            className="group relative shrink-0 rounded-md overflow-hidden"
          >
            <AlbumArt
              track={currentTrack}
              thumb
              className="w-12 h-12 md:w-14 md:h-14 rounded-md object-cover"
            />
            {currentTrack && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                {nowPlayingExpanded ? <ChevronDown className="w-6 h-6" /> : <ChevronUp className="w-6 h-6" />}
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{currentTrack?.title ?? "Nothing playing"}</div>
            <div className="truncate text-xs text-muted">
              <DownloadHint />
              {currentTrack ? (
                <>
                  <button onClick={() => showArtist(currentTrack.artist)} className="hover:text-fg hover:underline">
                    {currentTrack.artist}
                  </button>
                  {currentTrack.album && (
                    <>
                      <span className="mx-1.5 text-subtle">•</span>
                      <button
                        onClick={() => showAlbum(albumKey(currentTrack))}
                        className="hover:text-fg hover:underline"
                      >
                        {currentTrack.album}
                      </button>
                    </>
                  )}
                </>
              ) : (
                "Pick a song to start listening"
              )}
            </div>
          </div>
          {currentTrack && (
            <div className="hidden sm:flex items-center">
              <IconButton
                label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                onClick={() => void toggleFavorite(currentTrack.id)}
                className={isFavorite ? "text-accent! hover:text-accent!" : ""}
              >
                <Heart key={String(isFavorite)} className={`w-5 h-5 ${isFavorite ? "fill-current animate-pop" : ""}`} />
              </IconButton>
              <IconButton
                ref={moreRef}
                label="More"
                onClick={() => moreRef.current && openMenu(anchorFromElement(moreRef.current), currentTrack)}
              >
                <MoreVertical className="w-5 h-5" />
              </IconButton>
            </div>
          )}
        </div>

        {/* Transport */}
        <div className="flex items-center justify-center gap-1 md:gap-2 md:flex-1">
          <span className="hidden lg:block w-12 text-right text-xs text-muted tabular-nums">{formatTime(currentTime)}</span>
          <ShuffleButton className="max-sm:hidden" iconClassName="w-5 h-5" />
          <IconButton label="Previous" size="md" onClick={prev} disabled={disabled} className="max-sm:hidden text-fg!">
            <SkipBack className="w-6 h-6 fill-current" />
          </IconButton>
          <PlayPauseButton size="md" className="w-12! h-12!" />
          <IconButton label="Next" size="md" onClick={next} disabled={disabled} className="text-fg!">
            <SkipForward className="w-6 h-6 fill-current" />
          </IconButton>
          <RepeatButton className="max-sm:hidden" iconClassName="w-5 h-5" />
          <span className="hidden lg:block w-12 text-xs text-muted tabular-nums">{formatTime(duration)}</span>
        </div>

        {/* Sound + panels */}
        <div className="hidden md:flex items-center justify-end gap-0.5 md:w-[30%]">
          <VolumeControl className="hidden lg:flex mr-1" iconClassName="w-5 h-5" />
          <div className="hidden xl:block">
            <SleepTimer />
          </div>
          <IconButton
            label="Mini player"
            className="max-xl:hidden"
            onClick={() => void miniToggle().catch((err) => console.error("[mini] toggle failed:", err))}
          >
            <PictureInPicture2 className="w-5 h-5" />
          </IconButton>
          <IconButton label="Visualizer" active={activePanel === "visualizer"} onClick={() => togglePanel("visualizer")}>
            <AudioLines className="w-5 h-5" />
          </IconButton>
          <IconButton label="Lyrics" active={activePanel === "lyrics"} onClick={() => togglePanel("lyrics")}>
            <MicVocal className="w-5 h-5" />
          </IconButton>
          <IconButton label="Sound" active={activePanel === "equalizer"} onClick={() => togglePanel("equalizer")}>
            <SlidersVertical className="w-5 h-5" />
          </IconButton>
          <IconButton
            label="Queue"
            active={activePanel === "queue"}
            onClick={() => togglePanel("queue")}
            data-queue-toggle
          >
            <ListMusic className="w-5 h-5" />
          </IconButton>
          <IconButton label="Clear queue" onClick={clearQueue} disabled={queueEmpty}>
            <BrushCleaning className="w-5 h-5" />
          </IconButton>
          <IconButton
            label={nowPlayingExpanded ? "Close player" : "Open player"}
            onClick={toggleNowPlaying}
            disabled={disabled}
          >
            <motion.span animate={{ rotate: nowPlayingExpanded ? 180 : 0 }} transition={{ duration: 0.3 }} className="flex">
              <ChevronUp className="w-6 h-6" />
            </motion.span>
          </IconButton>
        </div>
      </div>
      {menu}
    </div>
  );
}

/** "Downloading 42% ·" prefix while the current track downloads from the vault. */
function DownloadHint() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const progress = useTrackDownload(currentTrack);
  const awaiting = useAwaitingAudio(currentTrack);
  if (!currentTrack || !awaiting) return null;
  const pct = progress && progress.total > 0 ? Math.floor((progress.downloaded / progress.total) * 100) : null;
  return <span className="text-accent font-medium">Loading{pct !== null ? ` ${pct}%` : "…"} · </span>;
}
