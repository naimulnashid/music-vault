/**
 * Canvas drawing for the visualizer, shared by the side panel and the full
 * player strip. Analysis frames arrive at ~30 fps as AnalyserNode-shaped
 * bytes (128 frequency bins, 256 waveform samples); drawing runs at the
 * display's rate and eases between frames so motion stays fluid.
 *
 * - bars: log-spaced spectrum (bass gets as many bars as treble), quick rise,
 *   slow fall, falling peak caps and a faint reflection.
 * - wave: the waveform, trigger-aligned so it holds still instead of
 *   jittering, eased between frames and drawn as one smooth glowing curve.
 * - flow: a scrolling loudness timeline, the last ~12 seconds of the song.
 */

export type VizMode = "bars" | "wave" | "flow";

export const VIZ_MODES: VizMode[] = ["bars", "wave", "flow"];

const MODE_KEY = "mv.vizMode";

export function loadVizMode(): VizMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved && (VIZ_MODES as string[]).includes(saved)) return saved as VizMode;
  } catch {
    // storage unavailable: start on bars
  }
  return "bars";
}

export function saveVizMode(mode: VizMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // the choice just doesn't persist
  }
}

export const FREQ_BINS = 128;
export const WAVE_SAMPLES = 256;

/** A frame older than this counts as silence (paused, or the source stopped sending). */
const STALE_MS = 250;
/** Flow: one column per this many ms; the strip shows width / column seconds of history. */
const FLOW_STEP_MS = 50;

export interface VizFrame {
  freq: Uint8Array;
  wave: Uint8Array;
  /** performance.now() when the frame arrived. */
  at: number;
  /** Sources that are read on demand (an AnalyserNode) fill the frame here, once per drawn frame. */
  pull?: (now: number) => void;
}

export function createFrame(): VizFrame {
  return { freq: new Uint8Array(FREQ_BINS), wave: new Uint8Array(WAVE_SAMPLES).fill(128), at: 0 };
}

interface Colors {
  accent: string;
  fg: string;
}

function readColors(): Colors {
  const css = getComputedStyle(document.documentElement);
  return {
    accent: css.getPropertyValue("--color-accent").trim() || "#8b5cf6",
    fg: css.getPropertyValue("--color-fg").trim() || "#ffffff",
  };
}

/** Linear-interpolated read of a fractional bin, so low bars that share a bin still differ. */
function sampleBin(freq: Uint8Array, pos: number): number {
  const i = Math.floor(pos);
  const f = pos - i;
  const a = freq[Math.min(i, freq.length - 1)];
  const b = freq[Math.min(i + 1, freq.length - 1)];
  return (a + (b - a) * f) / 255;
}

export class VizRenderer {
  private bars = new Float32Array(0);
  private peaks = new Float32Array(0);
  private peakVel = new Float32Array(0);
  private wave = new Float32Array(0);
  private flow: number[] = [];
  private flowLevel = 0;
  private lastFlowPush = 0;
  private colors: Colors = readColors();
  private colorsAt = 0;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly frame: VizFrame;

  constructor(ctx: CanvasRenderingContext2D, frame: VizFrame) {
    this.ctx = ctx;
    this.frame = frame;
  }

  draw(mode: VizMode, width: number, height: number, now: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    if (width <= 0 || height <= 0) return;
    // Theme can change while open; re-read the tokens now and then, not every frame.
    if (now - this.colorsAt > 1000) {
      this.colors = readColors();
      this.colorsAt = now;
    }
    this.frame.pull?.(now);
    const live = now - this.frame.at < STALE_MS;
    if (mode === "bars") this.drawBars(width, height, live);
    else if (mode === "wave") this.drawWave(width, height, live);
    else this.drawFlow(width, height, live, now);
  }

  private drawBars(width: number, height: number, live: boolean): void {
    const ctx = this.ctx;
    const count = Math.max(24, Math.min(120, Math.floor(width / 11)));
    if (this.bars.length !== count) {
      this.bars = new Float32Array(count);
      this.peaks = new Float32Array(count);
      this.peakVel = new Float32Array(count);
    }
    const gap = Math.max(2, Math.min(4, width / count / 4));
    const barW = (width - gap * (count - 1)) / count;
    const base = height * 0.8;
    const maxH = base - 4;
    // Bin 0 is DC and the top quarter is mostly empty in music: map bars
    // logarithmically over bins 1..96.
    const lo = 1;
    const hi = 96;
    const grad = this.ctx.createLinearGradient(0, base - maxH, 0, base);
    grad.addColorStop(0, this.colors.fg);
    grad.addColorStop(0.35, this.colors.accent);
    grad.addColorStop(1, this.colors.accent);

    for (let i = 0; i < count; i++) {
      const pos = lo * Math.pow(hi / lo, i / (count - 1));
      // Treble reads quieter than bass in the bytes; tilt it up a little.
      const tilt = 0.85 + 0.35 * (i / (count - 1));
      const target = live ? Math.min(1, Math.pow(sampleBin(this.frame.freq, pos), 1.4) * tilt) : 0;
      const cur = this.bars[i];
      this.bars[i] = target > cur ? cur + (target - cur) * 0.55 : cur + (target - cur) * 0.08;

      if (this.bars[i] >= this.peaks[i]) {
        this.peaks[i] = this.bars[i];
        this.peakVel[i] = 0;
      } else {
        this.peakVel[i] += 0.0009;
        this.peaks[i] = Math.max(this.bars[i], this.peaks[i] - this.peakVel[i]);
      }
    }

    const radius = Math.min(barW / 2, 4);
    for (let i = 0; i < count; i++) {
      const x = i * (barW + gap);
      const h = Math.max(3, this.bars[i] * maxH);
      ctx.globalAlpha = 0.55 + this.bars[i] * 0.45;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, base - h, barW, h, [radius, radius, 1, 1]);
      ctx.fill();
      // Reflection.
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = this.colors.accent;
      ctx.fillRect(x, base + 3, barW, Math.min(height - base - 3, h * 0.35));
      // Peak cap.
      if (this.peaks[i] > 0.02) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = this.colors.fg;
        ctx.fillRect(x, base - this.peaks[i] * maxH - 5, barW, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawWave(width: number, height: number, live: boolean): void {
    const ctx = this.ctx;
    const points = Math.max(48, Math.min(160, Math.floor(width / 7)));
    if (this.wave.length !== points) this.wave = new Float32Array(points);

    // Start on a rising zero crossing so successive frames line up.
    const src = this.frame.wave;
    let start = 0;
    for (let i = 1; i < src.length / 2; i++) {
      if (src[i - 1] < 128 && src[i] >= 128) {
        start = i;
        break;
      }
    }
    const span = src.length / 2;
    for (let p = 0; p < points; p++) {
      const idx = start + Math.floor((p / (points - 1)) * (span - 1));
      const target = live ? (src[idx] - 128) / 128 : 0;
      this.wave[p] += (target - this.wave[p]) * 0.22;
    }

    const mid = height / 2;
    const amp = height * 0.42;
    // Fade both ends to the centre line so the curve never cuts off at the edges.
    const y = (p: number) => {
      const t = p / (points - 1);
      const envelope = Math.sin(Math.PI * t);
      return mid + this.wave[p] * amp * envelope;
    };
    const stroke = (lineWidth: number, alpha: number, blur: number) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.shadowBlur = blur;
      ctx.shadowColor = this.colors.accent;
      ctx.strokeStyle = this.colors.accent;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      const step = width / (points - 1);
      ctx.moveTo(0, y(0));
      for (let p = 1; p < points - 1; p++) {
        const xc = p * step + step / 2;
        const yc = (y(p) + y(p + 1)) / 2;
        ctx.quadraticCurveTo(p * step, y(p), xc, yc);
      }
      ctx.lineTo(width, y(points - 1));
      ctx.stroke();
    };
    stroke(6, 0.18, 0);
    stroke(2.5, 1, 14);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = this.colors.fg;
    ctx.fillRect(0, mid - 0.5, width, 1);
    ctx.globalAlpha = 1;
  }

  private drawFlow(width: number, height: number, live: boolean, now: number): void {
    const ctx = this.ctx;
    // Loudness of the latest frame (RMS of the waveform), eased.
    let sum = 0;
    const src = this.frame.wave;
    for (let i = 0; i < src.length; i++) {
      const v = (src[i] - 128) / 128;
      sum += v * v;
    }
    const rms = live ? Math.min(1, Math.sqrt(sum / src.length) * 2.6) : 0;
    this.flowLevel += (rms - this.flowLevel) * 0.3;

    const colW = 4;
    const gap = 2;
    const capacity = Math.ceil(width / (colW + gap)) + 1;
    // Columns follow the clock, not the frame rate: a slow or throttled frame
    // adds the columns it missed, so the timeline scrolls at one speed.
    if (now - this.lastFlowPush > FLOW_STEP_MS * capacity) this.lastFlowPush = now - FLOW_STEP_MS;
    while (now - this.lastFlowPush >= FLOW_STEP_MS) {
      this.lastFlowPush += FLOW_STEP_MS;
      this.flow.push(this.flowLevel);
    }
    if (this.flow.length > capacity) this.flow.splice(0, this.flow.length - capacity);

    const mid = height / 2;
    const maxH = height * 0.46;
    // Newest column at the right edge; older ones scroll left and fade.
    for (let k = 0; k < this.flow.length; k++) {
      const age = this.flow.length - 1 - k;
      const x = width - colW - age * (colW + gap);
      if (x + colW < 0) continue;
      const level = this.flow[k];
      const h = Math.max(2, level * maxH);
      ctx.globalAlpha = 0.25 + 0.75 * (1 - age / capacity);
      ctx.fillStyle = level > 0.75 ? this.colors.fg : this.colors.accent;
      ctx.beginPath();
      ctx.roundRect(x, mid - h, colW, h * 2, 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
