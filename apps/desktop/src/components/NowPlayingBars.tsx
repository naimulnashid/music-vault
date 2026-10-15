/** Three bouncing bars marking the song that's playing (frozen while paused). */
export function NowPlayingBars({ playing, className = "" }: { playing: boolean; className?: string }) {
  return (
    <span className={`mv-eq ${className}`} data-paused={!playing} aria-label={playing ? "Playing" : "Paused"}>
      <span />
      <span />
      <span />
    </span>
  );
}
