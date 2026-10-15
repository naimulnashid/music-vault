import { useEffect, useState } from "react";
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { formatTime } from "@musicvault/core";
import { AlbumArt, Ambient } from "./AlbumArt";
import { Slider } from "./ui/Slider";
import { useTheme } from "../hooks/useTheme";
import { useSettingsStore } from "../store/settingsStore";
import { emitMiniCmd, emitMiniReady, miniToggle, onMiniState, type MiniState } from "../lib/miniBridge";

/**
 * The always-on-top mini player window. Pure remote control: all state
 * arrives over the mini:// event bridge from the (hidden) main window,
 * every action is sent back the same way.
 */
export function MiniPlayer() {
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  useTheme();

  const [state, setState] = useState<MiniState | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onMiniState((s) => setState(s)).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    // Ask the main window for the current snapshot once we're listening.
    void emitMiniReady();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const playing = state?.playing ?? false;
  const hasTrack = state?.hasTrack ?? false;
  const duration = state?.duration ?? 0;
  const position = Math.min(state?.position ?? 0, duration || 0);

  return (
    <div
      data-tauri-drag-region
      className="relative h-screen w-screen flex items-center gap-3 px-3 bg-bg border border-line select-none overflow-hidden"
    >
      <Ambient artworkPath={state?.artworkPath ?? undefined} strength={0.6} />
      <AlbumArt
        artworkPath={state?.artworkPath ?? undefined}
        thumb
        className="relative w-[96px] h-[96px] rounded-lg object-cover shrink-0 pointer-events-none shadow-lg"
      />

      <div className="relative flex-1 min-w-0 flex flex-col gap-1.5" data-tauri-drag-region>
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <div className="min-w-0 flex-1" data-tauri-drag-region>
            <div className="truncate text-sm font-bold" data-tauri-drag-region>
              {state?.title ?? "Nothing playing"}
            </div>
            <div className="truncate text-xs text-muted" data-tauri-drag-region>
              {state?.artist ?? "—"}
            </div>
          </div>
          <button
            onClick={() => void emitMiniCmd({ action: "favorite" })}
            disabled={!hasTrack}
            title="Favorite"
            className={`shrink-0 disabled:opacity-30 ${state?.favorite ? "text-accent" : "text-muted hover:text-fg"}`}
          >
            <Heart className="w-4 h-4" fill={state?.favorite ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => void miniToggle()}
            title="Back to full window"
            className="shrink-0 text-muted hover:text-fg"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void emitMiniCmd({ action: "prev" })}
            disabled={!hasTrack}
            className="disabled:opacity-30"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>
          <button
            onClick={() => void emitMiniCmd({ action: "toggle" })}
            disabled={!hasTrack}
            className="w-9 h-9 rounded-full bg-fg text-bg flex items-center justify-center transition-transform hover:scale-105 active:scale-95 disabled:opacity-30"
          >
            {playing ? <Pause className="w-4 h-4 fill-current" strokeWidth={0} /> : <Play className="w-4 h-4 ml-0.5 fill-current" strokeWidth={0} />}
          </button>
          <button
            onClick={() => void emitMiniCmd({ action: "next" })}
            disabled={!hasTrack}
            className="disabled:opacity-30"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
          <div className="flex-1 flex items-center gap-2 text-[10px] text-muted">
            <span className="tabular-nums">{formatTime(position)}</span>
            <Slider
              label="Seek"
              value={position}
              max={duration || 0}
              commitOnRelease
              onChange={(v) => void emitMiniCmd({ action: "seek", position: v })}
              disabled={!hasTrack}
              thickness={3}
              className="flex-1 min-w-0"
            />
            <span className="tabular-nums">{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
