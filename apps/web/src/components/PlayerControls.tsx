import { useRef } from "react";
import { Pause, Play, Repeat, Repeat1, Shuffle, Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import { IconButton } from "./ui/Button";
import { Slider } from "./ui/Slider";

/** Round play/pause; the icon swaps with a quick scale. */
export function PlayPauseButton({ size = "md", className = "" }: { size?: "md" | "lg" | "xl"; className?: string }) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const dims = size === "xl" ? "w-16 h-16" : size === "lg" ? "w-14 h-14" : "w-11 h-11";
  const icon = size === "md" ? "w-5 h-5" : "w-7 h-7";

  return (
    <button
      onClick={togglePlay}
      disabled={!currentTrack}
      title={isPlaying ? "Pause" : "Play"}
      aria-label={isPlaying ? "Pause" : "Play"}
      className={`${dims} shrink-0 rounded-full bg-fg text-bg flex items-center justify-center shadow-[0_6px_20px_-6px_rgb(0_0_0/0.5)] transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 ${className}`}
    >
      {/* Both icons share one grid cell and cross-fade in place. AnimatePresence's
          popLayout took the outgoing icon out of the flow, which slid it sideways. */}
      <span className="grid place-items-center">
        <Pause
          className={`${icon} fill-current col-start-1 row-start-1 transition-[opacity,scale] duration-150 ${isPlaying ? "opacity-100 scale-100" : "opacity-0 scale-50"}`}
          strokeWidth={0}
          aria-hidden
        />
        <Play
          className={`${icon} fill-current col-start-1 row-start-1 translate-x-[1px] transition-[opacity,scale] duration-150 ${isPlaying ? "opacity-0 scale-50" : "opacity-100 scale-100"}`}
          strokeWidth={0}
          aria-hidden
        />
      </span>
    </button>
  );
}

export function ShuffleButton({
  className = "",
  size = "sm",
  iconClassName = "w-[18px] h-[18px]",
}: {
  className?: string;
  size?: "sm" | "md";
  iconClassName?: string;
}) {
  const shuffle = useSettingsStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  return (
    <IconButton label={shuffle ? "Shuffle on" : "Shuffle off"} size={size} active={shuffle} onClick={toggleShuffle} className={className}>
      <Shuffle className={iconClassName} />
    </IconButton>
  );
}

export function RepeatButton({
  className = "",
  size = "sm",
  iconClassName = "w-[18px] h-[18px]",
}: {
  className?: string;
  size?: "sm" | "md";
  iconClassName?: string;
}) {
  const repeat = useSettingsStore((s) => s.repeat);
  const setRepeat = useSettingsStore((s) => s.setRepeat);
  const cycle = () => {
    const modes: Array<typeof repeat> = ["off", "all", "one"];
    setRepeat(modes[(modes.indexOf(repeat) + 1) % modes.length]);
  };
  const label = repeat === "off" ? "Repeat off" : repeat === "all" ? "Repeat all" : "Repeat one";
  return (
    <IconButton label={label} size={size} active={repeat !== "off"} onClick={cycle} className={className}>
      {repeat === "one" ? <Repeat1 className={iconClassName} /> : <Repeat className={iconClassName} />}
    </IconButton>
  );
}

/** Speaker (click = mute/unmute) plus a slim slider. */
export function VolumeControl({
  className = "",
  wide = false,
  iconClassName = "w-[18px] h-[18px]",
}: {
  className?: string;
  wide?: boolean;
  iconClassName?: string;
}) {
  const volume = useSettingsStore((s) => s.volume);
  const setVolume = useSettingsStore((s) => s.setVolume);
  const lastAudible = useRef(volume > 0 ? volume : 0.8);
  if (volume > 0) lastAudible.current = volume;

  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <IconButton
        label={volume === 0 ? "Unmute" : "Mute"}
        onClick={() => setVolume(volume === 0 ? lastAudible.current : 0)}
      >
        <Icon className={iconClassName} />
      </IconButton>
      <Slider
        label="Volume"
        value={volume}
        max={1}
        step={0.05}
        onChange={(v) => setVolume(Math.round(v * 100) / 100)}
        formatTooltip={(v) => `${Math.round(v * 100)}%`}
        className={wide ? "w-40" : "w-24"}
      />
    </div>
  );
}
