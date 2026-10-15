import { EQ_FREQS } from "../types";

export interface EngineCallbacks {
  onTime?: (time: number) => void;
  onDuration?: (duration: number) => void;
  onEnded?: () => void;
  onPlaying?: (playing: boolean) => void;
}

/**
 * Dual-element audio engine.
 *
 * Two <audio> elements feed independent gain nodes that mix into a single
 * shared EQ chain -> analyser -> master gain -> destination. Having two
 * independent sources is what makes overlap crossfade and preload-based
 * gapless playback possible; a single element cannot play two tracks at once.
 *
 * Master gain carries the user volume; the per-element "fade" gains are used
 * purely for the crossfade envelope (0..1). Only events from the currently
 * active element are forwarded to the app.
 */
class AudioEngine {
  private players: [HTMLAudioElement, HTMLAudioElement];
  private urls: [string | null, string | null] = [null, null];
  private activeIndex = 0;
  private ctx: AudioContext | null = null;
  private fadeGains: GainNode[] = [];
  private filters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.8;
  private cb: EngineCallbacks = {};

  constructor() {
    this.players = [new Audio(), new Audio()];
    this.players.forEach((p) => {
      p.preload = "auto";
      p.crossOrigin = "anonymous";
    });
    this.players.forEach((el) => this.attach(el));
  }

  setCallbacks(cb: EngineCallbacks): void {
    this.cb = cb;
  }

  private get activeElement(): HTMLAudioElement {
    return this.players[this.activeIndex];
  }

  private get inactiveIndex(): number {
    return this.activeIndex === 0 ? 1 : 0;
  }

  private attach(el: HTMLAudioElement) {
    el.addEventListener("timeupdate", () => {
      if (el === this.activeElement) this.cb.onTime?.(el.currentTime);
    });
    const emitDuration = () => {
      if (el === this.activeElement) this.cb.onDuration?.(el.duration || 0);
    };
    el.addEventListener("loadedmetadata", emitDuration);
    el.addEventListener("durationchange", emitDuration);
    el.addEventListener("ended", () => {
      if (el === this.activeElement) this.cb.onEnded?.();
    });
    el.addEventListener("play", () => {
      if (el === this.activeElement) this.cb.onPlaying?.(true);
    });
    el.addEventListener("pause", () => {
      if (el === this.activeElement) this.cb.onPlaying?.(false);
    });
  }

  private ensureGraph() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const fadeGains = this.players.map((el, i) => {
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = i === this.activeIndex ? 1 : 0;
      src.connect(gain);
      return gain;
    });

    const filters = EQ_FREQS.map((freq) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.volume;

    // Both element gains mix into the head of the EQ chain.
    fadeGains.forEach((g) => g.connect(filters[0]));
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(masterGain);
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);

    this.ctx = ctx;
    this.fadeGains = fadeGains;
    this.filters = filters;
    this.analyser = analyser;
    this.masterGain = masterGain;
  }

  async resumeContext(): Promise<void> {
    this.ensureGraph();
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  getAnalyser(): AnalyserNode | null {
    this.ensureGraph();
    return this.analyser;
  }

  /** Output sample rate of the AudioContext, or null before the graph exists. */
  getSampleRate(): number | null {
    return this.ctx?.sampleRate ?? null;
  }

  setEqBands(bands: number[]): void {
    this.ensureGraph();
    bands.forEach((gain, i) => {
      if (this.filters[i]) this.filters[i].gain.value = gain;
    });
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(volume, this.ctx.currentTime);
    }
  }

  private setSrc(index: number, blob: Blob) {
    if (this.urls[index]) URL.revokeObjectURL(this.urls[index]!);
    const url = URL.createObjectURL(blob);
    this.urls[index] = url;
    this.players[index].src = url;
    this.players[index].load();
  }

  private finalizeFade() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.fadeGains.forEach((g, i) => {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(i === this.activeIndex ? 1 : 0, now);
    });
  }

  /** Load a track into the active element for immediate playback (fresh play / manual jump). */
  loadTrack(blob: Blob): void {
    this.ensureGraph();
    this.finalizeFade();
    this.players[this.inactiveIndex].pause();
    this.setSrc(this.activeIndex, blob);
  }

  /** Buffer the upcoming track into the inactive element so a transition is seamless. */
  preloadNext(blob: Blob): void {
    this.ensureGraph();
    this.setSrc(this.inactiveIndex, blob);
  }

  async play(): Promise<void> {
    this.ensureGraph();
    await this.resumeContext();
    await this.activeElement.play().catch(() => {});
  }

  pause(): void {
    this.finalizeFade();
    this.players.forEach((p) => p.pause());
  }

  seek(time: number): void {
    // Seeking cancels any in-progress crossfade and snaps to the active track.
    this.finalizeFade();
    this.players[this.inactiveIndex].pause();
    this.activeElement.currentTime = time;
  }

  /** Overlap the preloaded next track with the current one over `duration` seconds. */
  async crossfadeToNext(duration: number): Promise<void> {
    this.ensureGraph();
    await this.resumeContext();
    const ctx = this.ctx!;
    const from = this.activeIndex;
    const to = this.inactiveIndex;
    const toEl = this.players[to];
    try {
      toEl.currentTime = 0;
    } catch {
      // currentTime may throw if metadata isn't ready; playback still starts at 0.
    }
    await toEl.play().catch(() => {});

    const now = ctx.currentTime;
    const dur = Math.max(0.1, duration);
    const gFrom = this.fadeGains[from].gain;
    const gTo = this.fadeGains[to].gain;
    gFrom.cancelScheduledValues(now);
    gTo.cancelScheduledValues(now);
    gFrom.setValueAtTime(gFrom.value, now);
    gTo.setValueAtTime(0, now);
    gFrom.linearRampToValueAtTime(0, now + dur);
    gTo.linearRampToValueAtTime(1, now + dur);

    this.activeIndex = to;
    this.emitActiveState();
    const fromEl = this.players[from];
    window.setTimeout(() => {
      if (this.activeIndex !== from) fromEl.pause();
    }, dur * 1000 + 80);
  }

  /** Instantly switch to the preloaded next track (gapless: no decode gap because it's buffered). */
  async hardSwitchToPreloaded(): Promise<void> {
    this.ensureGraph();
    await this.resumeContext();
    const ctx = this.ctx!;
    const from = this.activeIndex;
    const to = this.inactiveIndex;
    const now = ctx.currentTime;
    this.fadeGains[from].gain.cancelScheduledValues(now);
    this.fadeGains[to].gain.cancelScheduledValues(now);
    this.fadeGains[from].gain.setValueAtTime(0, now);
    this.fadeGains[to].gain.setValueAtTime(1, now);
    this.activeIndex = to;
    const el = this.players[to];
    try {
      el.currentTime = 0;
    } catch {
      // Ignore; playback starts at 0 regardless.
    }
    await el.play().catch(() => {});
    this.emitActiveState();
    this.players[from].pause();
  }

  // After swapping the active element, its loadedmetadata/durationchange events
  // already fired (and were ignored) while it was inactive, so push the new
  // duration/time to the app explicitly.
  private emitActiveState() {
    const el = this.activeElement;
    this.cb.onDuration?.(el.duration || 0);
    this.cb.onTime?.(el.currentTime || 0);
  }
}

export const audioEngine = new AudioEngine();
