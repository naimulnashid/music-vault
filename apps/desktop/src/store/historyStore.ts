import { create } from "zustand";

const HISTORY_KEY = "music-vault-history";
const COUNTS_KEY = "music-vault-playcounts";
const LISTEN_KEY = "music-vault-listenseconds";
const LAST_PLAYED_KEY = "music-vault-lastplayed";
const MAX_HISTORY = 100;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures (quota / private mode).
  }
}

interface HistoryState {
  recentIds: string[];
  playCounts: Record<string, number>;
  listenSeconds: Record<string, number>;
  /** Epoch ms of each track's most recent play — drives Last Played smart rules. */
  lastPlayedAt: Record<string, number>;
  recordPlay: (id: string) => void;
  addListenSeconds: (id: string, seconds: number) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  recentIds: loadJson<string[]>(HISTORY_KEY, []),
  playCounts: loadJson<Record<string, number>>(COUNTS_KEY, {}),
  listenSeconds: loadJson<Record<string, number>>(LISTEN_KEY, {}),
  lastPlayedAt: loadJson<Record<string, number>>(LAST_PLAYED_KEY, {}),

  recordPlay: (id: string) => {
    const filtered = get().recentIds.filter((existing) => existing !== id);
    const recentIds = [id, ...filtered].slice(0, MAX_HISTORY);
    const playCounts = { ...get().playCounts, [id]: (get().playCounts[id] ?? 0) + 1 };
    const lastPlayedAt = { ...get().lastPlayedAt, [id]: Date.now() };
    persist(HISTORY_KEY, recentIds);
    persist(COUNTS_KEY, playCounts);
    persist(LAST_PLAYED_KEY, lastPlayedAt);
    set({ recentIds, playCounts, lastPlayedAt });
  },

  addListenSeconds: (id: string, seconds: number) => {
    if (seconds <= 0) return;
    const listenSeconds = { ...get().listenSeconds, [id]: (get().listenSeconds[id] ?? 0) + seconds };
    persist(LISTEN_KEY, listenSeconds);
    set({ listenSeconds });
  },

  // Clears the recently-played order but keeps play counts (which drive
  // Most Played / Never Played).
  clear: () => {
    persist(HISTORY_KEY, []);
    set({ recentIds: [] });
  },
}));
