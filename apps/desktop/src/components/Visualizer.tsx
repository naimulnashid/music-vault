import { useEffect, useRef, useState } from "react";
import { Activity, AudioLines, AudioWaveform, X } from "lucide-react";
import { PanelHeader } from "./PanelHeader";
import { useUiStore } from "../store/uiStore";
import { player } from "../lib/player";
import { onSpectrum } from "../lib/ipc";
import { createFrame, FREQ_BINS, loadVizMode, saveVizMode, VizRenderer, WAVE_SAMPLES, type VizFrame, type VizMode } from "../lib/vizRender";

const MODES: { key: VizMode; label: string; Icon: typeof AudioLines }[] = [
  { key: "bars", label: "Bars", Icon: AudioLines },
  { key: "wave", label: "Wave", Icon: Activity },
  { key: "flow", label: "Flow", Icon: AudioWaveform },
];

// The side panel can still be animating out while the full player's strip
// mounts, so the engine stays on until the last visualizer is gone.
let mounted = 0;

/**
 * Feeds `frame` from the Rust engine (rustfft, shaped like AnalyserNode
 * output). The engine only emits while a visualizer is mounted.
 */
function useAnalysis(frame: VizFrame): void {
  useEffect(() => {
    if (mounted++ === 0) player.setVisualizer(true);
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onSpectrum(({ freq, wave }) => {
      for (let i = 0; i < FREQ_BINS && i < freq.length; i++) frame.freq[i] = freq[i];
      for (let i = 0; i < WAVE_SAMPLES && i < wave.length; i++) frame.wave[i] = wave[i];
      frame.at = performance.now();
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (--mounted === 0) player.setVisualizer(false);
    };
  }, [frame]);
}

function ModePicker({ mode, onChange }: { mode: VizMode; onChange: (mode: VizMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-surface-2/80 rounded-full p-0.5" role="radiogroup" aria-label="Visualizer style">
      {MODES.map(({ key, label, Icon }) => (
        <button
          key={key}
          role="radio"
          aria-checked={mode === key}
          onClick={() => onChange(key)}
          title={label}
          className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
            mode === key ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
}

/**
 * "panel" is the side panel; "stage" is the wide strip across the full
 * player, with its controls floating in the corner.
 */
export function Visualizer({ variant = "panel" }: { variant?: "panel" | "stage" }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setModeState] = useState<VizMode>(loadVizMode);
  const modeRef = useRef(mode);
  const [frame] = useState(createFrame);
  const closePanel = useUiStore((s) => s.closePanel);
  useAnalysis(frame);

  const setMode = (next: VizMode) => {
    modeRef.current = next;
    setModeState(next);
    saveVizMode(next);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const renderer = new VizRenderer(ctx, frame);

    // The backing buffer is sized from a ResizeObserver, not by reading the
    // box every frame: that forced a layout per frame and made the panel creep.
    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      renderer.draw(modeRef.current, width, height, now);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [frame]);

  if (variant === "stage") {
    return (
      <div className="relative h-full w-full">
        <canvas ref={canvasRef} className="block w-full h-full" aria-hidden />
        <div className="absolute top-1 right-0 flex items-center gap-1">
          <ModePicker mode={mode} onChange={setMode} />
          <button
            onClick={closePanel}
            aria-label="Close visualizer"
            title="Close visualizer"
            className="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-fg hover:bg-surface-2/80 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader title="Visualizer">
        <ModePicker mode={mode} onChange={setMode} />
      </PanelHeader>
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <canvas ref={canvasRef} className="block w-full h-full" aria-hidden />
      </div>
    </div>
  );
}
