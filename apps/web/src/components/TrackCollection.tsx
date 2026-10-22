import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { LayoutGrid, List, MoreVertical, Pause, Play } from "lucide-react";
import type { Track } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { AlbumArt } from "./AlbumArt";
import { NowPlayingBars } from "./NowPlayingBars";
import { TrackList } from "./TrackList";
import { useTrackMenu } from "./TrackMenu";
import { anchorFromElement, type MenuAnchor } from "./ui/Menu";

export type ViewMode = "list" | "covers";

/** The list/cover choice per page, remembered on this device only. */
export function useViewMode(page: string): [ViewMode, (mode: ViewMode) => void] {
  const key = `mv.view.${page}`;
  const read = useCallback((): ViewMode => {
    try {
      return localStorage.getItem(key) === "covers" ? "covers" : "list";
    } catch {
      return "list";
    }
  }, [key]);
  const [mode, setMode] = useState<ViewMode>(read);
  useEffect(() => setMode(read()), [read]);
  const set = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };
  return [mode, set];
}

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const button = (value: ViewMode, title: string, icon: ReactNode) => (
    <button
      onClick={() => onChange(value)}
      title={title}
      aria-label={title}
      aria-pressed={mode === value}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
        mode === value ? "bg-surface-3 text-fg" : "text-muted hover:text-fg hover:bg-surface-2"
      }`}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex items-center gap-1 shrink-0">
      {button("list", "List view", <List className="w-4 h-4" />)}
      {button("covers", "Cover view", <LayoutGrid className="w-4 h-4" />)}
    </div>
  );
}

const MIN_CARD = 160;
const GAP_X = 16;
const GAP_Y = 24;
/** Title and artist lines under the square cover. */
const CAPTION = 50;

/**
 * Songs as cover cards, windowed by rows like TrackList so a whole library
 * stays smooth. Clicking a card plays the list from that song.
 */
function SongGrid({ tracks }: { tracks: Track[] }) {
  const currentId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const { openMenu, menu } = useTrackMenu();

  const [width, setWidth] = useState(0);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  const columns = Math.max(2, Math.floor((width + GAP_X) / (MIN_CARD + GAP_X)));
  const cardWidth = width > 0 ? (width - GAP_X * (columns - 1)) / columns : MIN_CARD;
  const rowHeight = Math.round(cardWidth + CAPTION + GAP_Y);
  const rows = Math.ceil(tracks.length / columns);
  const { listRef, start, end, padTop, padBottom } = useVirtualRows(rows, rowHeight);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      setEl(node);
      listRef(node);
    },
    [listRef],
  );

  const play = (index: number) => {
    if (tracks[index].id === currentId) togglePlay();
    else playQueue(tracks, index);
  };

  return (
    <div ref={ref} className="px-6 md:px-8 pb-10">
      <div style={{ height: padTop }} />
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP_X }}>
        {tracks.slice(start * columns, end * columns).map((track, i) => (
          <SongCard
            key={track.id}
            track={track}
            index={start * columns + i}
            height={rowHeight}
            isCurrent={track.id === currentId}
            isPlaying={isPlaying}
            onPlay={play}
            onMenu={openMenu}
          />
        ))}
      </div>
      <div style={{ height: padBottom }} />
      {menu}
    </div>
  );
}

const SongCard = memo(function SongCard({
  track,
  index,
  height,
  isCurrent,
  isPlaying,
  onPlay,
  onMenu,
}: {
  track: Track;
  index: number;
  height: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  onMenu: (anchor: MenuAnchor, track: Track) => void;
}) {
  return (
    <div
      style={{ height }}
      className="group min-w-0"
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY }, track);
      }}
    >
      <button onClick={() => onPlay(index)} className="relative block w-full rounded-xl overflow-hidden bg-surface-2" title={track.title}>
        <AlbumArt
          track={track}
          thumb
          className="w-full aspect-square object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200" />
        {isCurrent && (
          <span className="absolute left-2.5 bottom-2.5 px-2 py-1.5 rounded-full bg-black/60 text-accent group-hover:opacity-0 transition-opacity">
            <NowPlayingBars playing={isPlaying} />
          </span>
        )}
        <span className="absolute right-2.5 bottom-2.5 w-11 h-11 rounded-full bg-accent text-accent-fg flex items-center justify-center shadow-[0_8px_20px_-6px_rgb(0_0_0/0.6)] opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-200">
          {isCurrent && isPlaying ? (
            <Pause className="w-5 h-5 fill-current" strokeWidth={0} />
          ) : (
            <Play className="w-5 h-5 fill-current translate-x-[1px]" strokeWidth={0} />
          )}
        </span>
      </button>
      <div className="flex items-start gap-1 mt-2.5">
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold truncate ${isCurrent ? "text-accent" : ""}`}>{track.title}</div>
          <div className="text-xs text-muted truncate mt-0.5">{track.artist}</div>
        </div>
        <button
          onClick={(e) => onMenu(anchorFromElement(e.currentTarget), track)}
          title="More"
          className="shrink-0 w-7 h-7 -mr-1 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

/**
 * A page's songs as a list or as covers, with the toggle in a bar above.
 * `toolbar` sits at the bar's start (sort chips, headings). The list keeps
 * every TrackList feature; covers are for browsing and playing.
 */
export function TrackCollection({
  page,
  tracks,
  toolbar,
  ...listProps
}: {
  page: string;
  tracks: Track[];
  toolbar?: ReactNode;
} & Omit<Parameters<typeof TrackList>[0], "tracks">) {
  const [mode, setMode] = useViewMode(page);
  return (
    <>
      <div className="px-6 md:px-8 pb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>
      {mode === "covers" ? <SongGrid tracks={tracks} /> : <TrackList tracks={tracks} {...listProps} />}
    </>
  );
}
