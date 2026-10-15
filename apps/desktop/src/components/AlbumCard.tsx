import type { ReactNode } from "react";
import { Play } from "lucide-react";
import { motion } from "motion/react";
import type { Album } from "@musicvault/core";
import type { Track } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import { useUiStore } from "../store/uiStore";
import { AlbumArt } from "./AlbumArt";

/** Responsive card grid used for albums, artists and groups. */
export function CardGrid({ children, min = 168 }: { children: ReactNode; min?: number }) {
  return (
    <div className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
      {children}
    </div>
  );
}

/** Staggered fade-up for the first screenful of cards only. */
export function cardMotion(index: number) {
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, delay: Math.min(index, 18) * 0.025, ease: [0.16, 1, 0.3, 1] as const },
  };
}

/** Round play button that floats up over a card's artwork on hover. */
export function CardPlayButton({ tracks }: { tracks: Track[] }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const setShuffle = useSettingsStore((s) => s.setShuffle);
  return (
    <span
      role="button"
      tabIndex={-1}
      title="Play"
      onClick={(e) => {
        e.stopPropagation();
        setShuffle(false);
        playQueue(tracks, 0);
      }}
      className="absolute right-2.5 bottom-2.5 w-11 h-11 rounded-full bg-accent text-accent-fg flex items-center justify-center shadow-[0_8px_20px_-6px_rgb(0_0_0/0.6)] opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-200 hover:scale-105 active:scale-95"
    >
      <Play className="w-5 h-5 fill-current translate-x-[1px]" strokeWidth={0} />
    </span>
  );
}

export function AlbumCard({ album, index = 0, showArtist = true }: { album: Album<Track>; index?: number; showArtist?: boolean }) {
  const showAlbum = useUiStore((s) => s.showAlbum);
  const year = album.tracks.find((t) => t.year)?.year;
  return (
    <motion.button {...cardMotion(index)} onClick={() => showAlbum(album.key)} className="group text-left min-w-0">
      <div className="relative rounded-xl overflow-hidden mb-3 bg-surface-2">
        <AlbumArt
          track={album.tracks[0]}
          thumb
          className="w-full aspect-square object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200" />
        <CardPlayButton tracks={album.tracks} />
      </div>
      <div className="text-sm font-semibold truncate">{album.album || "Unknown album"}</div>
      <div className="text-xs text-muted truncate mt-0.5">
        {showArtist ? album.artist : `${album.tracks.length} ${album.tracks.length === 1 ? "song" : "songs"}`}
        {year ? ` • ${year}` : ""}
      </div>
    </motion.button>
  );
}
