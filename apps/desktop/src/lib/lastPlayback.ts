const KEY = "music-vault-lastplayback";

export interface LastPlayback {
  trackId: string;
  time: number;
  /**
   * When this device last played (ms). Only playing moves it, never a save on pause or
   * after a restore, so the queue handoff can tell use from a restore.
   */
  playedAt?: number;
}

export function loadLastPlayback(): LastPlayback | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LastPlayback) : null;
  } catch {
    return null;
  }
}

export function saveLastPlayback(trackId: string, time: number, played = false): void {
  try {
    const playedAt = played ? Date.now() : loadLastPlayback()?.playedAt;
    localStorage.setItem(KEY, JSON.stringify({ trackId, time, playedAt } satisfies LastPlayback));
  } catch {
    // Ignore storage failures (quota / private mode).
  }
}

export function clearLastPlayback(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore storage failures (quota / private mode).
  }
}
