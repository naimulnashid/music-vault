import {
  playerLoad,
  playerPause,
  playerPlay,
  playerPreloadNext,
  playerSeek,
  playerSetCrossfade,
  playerSetEq,
  playerSetGapless,
  playerSetRg,
  playerSetVisualizer,
  playerSetVolume,
  playerStop,
} from "./ipc";

/**
 * Thin client for the native Rust audio engine.
 *
 * Mirrors the method surface of the old Web Audio engine so stores and hooks
 * keep the same call sites, but all mechanics (decoding, EQ, gapless splice,
 * crossfade ramps, output-device handling) live in the Rust backend. State
 * updates come back asynchronously via player:// events (see lib/ipc.ts).
 *
 * Command failures are logged rather than thrown: playback errors surface
 * through the player://error event channel instead.
 */
function fireAndLog(promise: Promise<void>, op: string): void {
  promise.catch((err) => console.error(`[player] ${op} failed:`, err));
}

export const player = {
  /** Load a track for immediate playback (fresh play / manual jump). */
  loadTrack(path: string, startAt = 0, autoplay = true, rgDb: number | null = null): void {
    fireAndLog(playerLoad(path, startAt, autoplay, rgDb), "load");
  },

  /** Arm the upcoming track so the engine can splice it in seamlessly. */
  preloadNext(path: string | null, rgDb: number | null = null): void {
    fireAndLog(playerPreloadNext(path, rgDb), "preloadNext");
  },

  /** Live ReplayGain change for the already-playing track (mode switches). */
  setReplayGain(rgDb: number | null): void {
    fireAndLog(playerSetRg(rgDb), "setReplayGain");
  },

  play(): void {
    fireAndLog(playerPlay(), "play");
  },

  pause(): void {
    fireAndLog(playerPause(), "pause");
  },

  stop(): void {
    fireAndLog(playerStop(), "stop");
  },

  seek(position: number): void {
    fireAndLog(playerSeek(position), "seek");
  },

  setVolume(volume: number): void {
    fireAndLog(playerSetVolume(volume), "setVolume");
  },

  setEqBands(bands: number[]): void {
    fireAndLog(playerSetEq(bands), "setEq");
  },

  setCrossfade(seconds: number): void {
    fireAndLog(playerSetCrossfade(seconds), "setCrossfade");
  },

  setGapless(enabled: boolean): void {
    fireAndLog(playerSetGapless(enabled), "setGapless");
  },

  setVisualizer(enabled: boolean): void {
    fireAndLog(playerSetVisualizer(enabled), "setVisualizer");
  },
};
