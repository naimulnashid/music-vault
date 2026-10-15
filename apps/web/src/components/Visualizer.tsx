import { PanelHeader } from "./PanelHeader";
import { useEffect, useRef, useState } from "react";
import { Activity, AudioLines } from "lucide-react";
import { audioEngine } from "../lib/audioEngine";

type Mode = "spectrum" | "waveform";

export function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>("spectrum");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = audioEngine.getAnalyser();
    if (!analyser) return;
    const bufferLength = analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(analyser.fftSize);

    const accent = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#a855f7";

    // Size the backing buffer from the canvas's own box (measured once per
    // resize via ResizeObserver) rather than re-reading clientWidth/Height on
    // every animation frame — that forced a synchronous layout each frame,
    // which under some flex layouts made the panel's height creep and the
    // page visibly scroll while the visualizer was open.
    let width = 0;
    let height = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
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

    const drawSpectrum = () => {
      analyser.getByteFrequencyData(freqData);
      const barCount = 48;
      const step = Math.floor(bufferLength / barCount);
      const gap = 2;
      const barWidth = (width - gap * (barCount - 1)) / barCount;
      ctx.fillStyle = accent();
      for (let i = 0; i < barCount; i++) {
        const value = freqData[i * step] / 255;
        const barHeight = Math.max(2, value * height);
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        ctx.globalAlpha = 0.35 + value * 0.65;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
      ctx.globalAlpha = 1;
    };

    const drawWaveform = () => {
      analyser.getByteTimeDomainData(timeData);
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent();
      ctx.beginPath();
      const sliceWidth = width / timeData.length;
      let x = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i] / 128 - 1;
        const y = height / 2 + v * (height / 2) * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
    };

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, width, height);
      if (mode === "spectrum") drawSpectrum();
      else drawWaveform();
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [mode]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader title="Visualizer">
        <div className="flex items-center gap-0.5 bg-surface-2 rounded-full p-0.5">
          <button
            onClick={() => setMode("spectrum")}
            title="Spectrum"
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              mode === "spectrum" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            }`}
          >
            <AudioLines className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMode("waveform")}
            title="Waveform"
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              mode === "waveform" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
          </button>
        </div>
      </PanelHeader>
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
      <p className="px-4 pb-4 text-xs text-muted">
        Reacts to whatever is playing. Play a track to see it move.
      </p>
    </div>
  );
}
