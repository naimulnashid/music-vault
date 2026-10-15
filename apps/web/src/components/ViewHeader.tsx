import type { ReactNode } from "react";
import { Play, Shuffle } from "lucide-react";
import { motion } from "motion/react";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import type { Track } from "../types";
import { Ambient } from "./AlbumArt";
import { Button } from "./ui/Button";

/** Title row of a list view (Library, Statistics, Downloads, …). */
export function ViewHeader({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-6 md:px-8 pt-5 pb-4 flex flex-wrap items-end gap-x-4 gap-y-3 ${className}`}>
      {title !== undefined && (
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-extrabold tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1 truncate">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Big header for a collection (album, artist, playlist, group): colour wash
 * from the artwork, cover, kind label, title, meta line and actions.
 */
export function Hero({
  kind,
  title,
  meta,
  cover,
  artTrack,
  actions,
  children,
}: {
  kind: string;
  title: ReactNode;
  meta?: ReactNode;
  /** The cover element (album art, artist circle, playlist mosaic). */
  cover: ReactNode;
  /** Song whose artwork the colour wash is taken from. */
  artTrack?: Track | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative px-6 md:px-8 pt-6 pb-6">
      <Ambient track={artTrack} strength={0.5} className="[mask-image:linear-gradient(to_bottom,transparent,black_96px)]" />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex flex-col sm:flex-row gap-6 sm:gap-8 items-center sm:items-end"
      >
        <div className="shrink-0 shadow-[0_20px_50px_-15px_rgb(0_0_0/0.6)] rounded-xl">{cover}</div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{kind}</p>
          <h1 className="mt-2 text-3xl md:text-4xl xl:text-5xl font-extrabold tracking-tight leading-[1.08] line-clamp-2 break-words">
            {title}
          </h1>
          {meta && <div className="mt-3 text-sm text-muted">{meta}</div>}
          {actions && <div className="mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-2">{actions}</div>}
        </div>
      </motion.div>
      {children}
    </section>
  );
}

/** Play + Shuffle pills for a collection. */
export function PlayShuffleButtons({ tracks }: { tracks: Track[] }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const setShuffle = useSettingsStore((s) => s.setShuffle);
  const disabled = tracks.length === 0;
  return (
    <>
      <Button
        variant="primary"
        size="lg"
        disabled={disabled}
        onClick={() => {
          setShuffle(false);
          playQueue(tracks, 0);
        }}
        icon={<Play className="w-4 h-4 fill-current" />}
      >
        Play
      </Button>
      <Button
        variant="secondary"
        size="lg"
        disabled={disabled}
        onClick={() => {
          setShuffle(true);
          playQueue(tracks, Math.floor(Math.random() * tracks.length));
        }}
        icon={<Shuffle className="w-4 h-4" />}
      >
        Shuffle
      </Button>
    </>
  );
}
