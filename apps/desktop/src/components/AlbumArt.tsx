import { Music } from "lucide-react";
import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { artworkDir } from "../lib/paths";
import type { Track } from "../types";

/**
 * URL of a track's artwork. Files live in the app's artwork cache dir and are
 * served through Tauri's asset protocol (scoped to that directory in
 * tauri.conf.json). `thumb` prefers the ~256px `.thumb.jpg` variant.
 */
export function useArtworkUrl(artworkPath: string | undefined, thumb: boolean, thumbFailed = false): string | null {
  return useMemo(() => {
    if (!artworkPath) return null;
    const dir = artworkDir();
    if (!dir) return null;
    const name = thumb && !thumbFailed ? artworkPath.replace(/\.[^.]+$/, ".thumb.jpg") : artworkPath;
    return convertFileSrc(`${dir}\\${name}`);
  }, [artworkPath, thumb, thumbFailed]);
}

/** What a component needs to find a song's artwork (desktop: the cached file). */
export type ArtSource = Pick<Track, "artworkPath">;

/** Tracks with the same key show the same picture (mosaics dedupe on it). */
export function artKeyOf(track: ArtSource): string | undefined {
  return track.artworkPath;
}

export function AlbumArt({
  track,
  artworkPath: explicitPath,
  className,
  thumb,
}: {
  track?: ArtSource | null;
  /** A file in the artwork dir that isn't a library song's (staged covers). */
  artworkPath?: string;
  className?: string;
  /** Prefer the ~256px `.thumb.jpg` variant (list rows, grids). */
  thumb?: boolean;
}) {
  const artworkPath = explicitPath ?? track?.artworkPath;
  // A thumb that predates the thumbnail pipeline may not exist yet — the
  // backfill fills them in — so <img onError> falls back to the full art.
  const [thumbFailed, setThumbFailed] = useState(false);
  const url = useArtworkUrl(artworkPath, !!thumb, thumbFailed);

  if (url) {
    return (
      <img
        key={url}
        src={url}
        alt=""
        draggable={false}
        className={`${className} bg-surface-2 animate-fade-in`}
        loading="lazy"
        onError={thumb && !thumbFailed ? () => setThumbFailed(true) : undefined}
      />
    );
  }
  return (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-surface-3 to-surface-2 text-subtle`}>
      <Music className="w-2/5 h-2/5 max-w-12 max-h-12" strokeWidth={1.5} />
    </div>
  );
}

/**
 * Soft colour wash taken from the artwork: the thumb, blurred far past
 * recognition, crossfading when the art changes. Sits behind hero headers
 * and the Now Playing screen.
 */
export function Ambient({
  track,
  artworkPath,
  className = "",
  strength = 0.55,
}: {
  track?: ArtSource | null;
  artworkPath?: string;
  className?: string;
  strength?: number;
}) {
  const url = useArtworkUrl(artworkPath ?? track?.artworkPath, true);
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <AnimatePresence initial={false}>
        {url && (
          <motion.img
            key={url}
            src={url}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: strength }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute inset-0 w-full h-full object-cover scale-150 blur-[80px] saturate-[1.8]"
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/40 to-bg" />
    </div>
  );
}
