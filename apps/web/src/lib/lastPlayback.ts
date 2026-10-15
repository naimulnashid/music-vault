const KEY = "music-vault-lastplayback";

export interface LastPlayback {
  trackId: string;
  time: number;
}

export function loadLastPlayback(): LastPlayback | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LastPlayback) : null;
  } catch {
    return null;
  }
}

export function saveLastPlayback(trackId: string, time: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ trackId, time } satisfies LastPlayback));
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
