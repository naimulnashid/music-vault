import { AlbumArt } from "./AlbumArt";
import type { Track } from "../types";

/**
 * The cover as the label of a record that turns while the song plays and
 * stops where it is on pause. The grooves turn with it; the light on the
 * vinyl stays put, which is what sells the spin.
 */
export function SpinningDisc({ track, playing, className = "" }: { track: Track; playing: boolean; className?: string }) {
  return (
    <div className={`relative aspect-square rounded-full ${className}`}>
      <div
        className="mv-disc absolute inset-0 rounded-full shadow-[0_30px_80px_-20px_rgb(0_0_0/0.75)]"
        style={{ animationPlayState: playing ? "running" : "paused" }}
      >
        <div className="mv-disc-grooves absolute inset-0 rounded-full" />
        <div className="absolute inset-[24%] rounded-full overflow-hidden ring-4 ring-black/40">
          <AlbumArt track={track} className="w-full h-full object-cover" />
        </div>
        {/* Spindle hole. */}
        <div className="absolute left-1/2 top-1/2 w-[3.5%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg ring-2 ring-black/50" />
      </div>
      <div aria-hidden className="mv-disc-sheen pointer-events-none absolute inset-0 rounded-full" />
    </div>
  );
}
