import { Music } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useArtworkUrl } from "../lib/artwork";
import type { Track } from "../types";

/** What a component needs to find a song's artwork (web: cached per track id). */
export type ArtSource = Pick<Track, "id" | "artworkKey">;

/** Tracks with the same key show the same picture (mosaics dedupe on it). */
export function artKeyOf(track: ArtSource): string | undefined {
  return track.artworkKey;
}

/**
 * Artwork comes from the vault cover (or the downloaded audio) and is cached
 * in IndexedDB; songs without any show a placeholder.
 */
export function AlbumArt({
  track,
  trackId,
  className,
  thumb,
}: {
  track?: ArtSource | null;
  trackId?: string;
  className?: string;
  /** Prefer the ~256px thumbnail variant (list rows, grids). */
  thumb?: boolean;
}) {
  const url = useArtworkUrl(trackId ?? track?.id, thumb);

  if (url) {
    return (
      <img
        key={url}
        src={url}
        alt=""
        draggable={false}
        className={`${className} bg-surface-2 animate-fade-in`}
        loading="lazy"
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
  className = "",
  strength = 0.55,
}: {
  track?: ArtSource | null;
  className?: string;
  strength?: number;
}) {
  const url = useArtworkUrl(track?.id, true);
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
