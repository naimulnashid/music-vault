import { Play } from "lucide-react";

/** Three bouncing bars marking the song that's playing; a play icon while it's paused. */
export function NowPlayingBars({ playing, className = "" }: { playing: boolean; className?: string }) {
  // Frozen bars still read as "playing"; the icon also says what clicking the current row does.
  if (!playing) {
    return (
      <span className={`inline-flex items-end h-[14px] ${className}`} aria-label="Paused">
        <Play className="w-3.5 h-3.5 fill-current" />
      </span>
    );
  }
  return (
    <span className={`mv-eq ${className}`} aria-label="Playing">
      <span />
      <span />
      <span />
    </span>
  );
}
