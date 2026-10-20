import { create } from "zustand";
import type { Track } from "../types";
import { useSettingsStore } from "./settingsStore";
import { audioEngine } from "../lib/audioEngine";
import { clearLastPlayback } from "../lib/lastPlayback";

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface PlayerState {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  currentTrack: Track | null;
  /** Track id currently being fetched from the vault (download-then-play). */
  resolvingId: string | null;
  playQueue: (tracks: Track[], startIndex: number) => void;
  restoreTrack: (track: Track, time: number) => void;
  /** Loads a whole queue paused (cross-device handoff / session restore). */
  restoreQueue: (tracks: Track[], index: number, time: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  getNextIndex: () => number | null;
  jumpTo: (index: number) => void;
  /** Inserts tracks right after the current one. */
  playNext: (tracks: Track[]) => void;
  /** Appends tracks to the end of the queue. */
  addToQueue: (tracks: Track[]) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  seekTo: (time: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setResolvingId: (id: string | null) => void;
  toggleShuffle: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  currentTrack: null,
  resolvingId: null,

  playQueue: (tracks, startIndex) => {
    const shuffle = useSettingsStore.getState().shuffle;
    const startTrack = tracks[startIndex];
    let queue = tracks;
    let index = startIndex;
    if (shuffle) {
      const rest = tracks.filter((_, i) => i !== startIndex);
      queue = [startTrack, ...shuffleArray(rest)];
      index = 0;
    }
    set({ queue, currentIndex: index, currentTrack: startTrack, isPlaying: true, currentTime: 0, duration: startTrack.duration });
  },

  // Loads a track paused at a saved position (last playback resume) without
  // recording a new play or autoplaying.
  restoreTrack: (track, time) => {
    set({ queue: [track], currentIndex: 0, currentTrack: track, isPlaying: false, currentTime: time, duration: 0 });
  },

  restoreQueue: (tracks, index, time) => {
    if (tracks.length === 0) return;
    set({
      queue: tracks,
      currentIndex: index,
      currentTrack: tracks[index] ?? null,
      isPlaying: false,
      currentTime: time,
      duration: 0,
    });
  },

  togglePlay: () => {
    const { currentTrack, isPlaying } = get();
    if (!currentTrack) return;
    set({ isPlaying: !isPlaying });
  },

  next: () => {
    const { queue, currentIndex } = get();
    if (queue.length === 0) return;
    const repeat = useSettingsStore.getState().repeat;
    if (repeat === "one") {
      audioEngine.seek(0);
      void audioEngine.play();
      set({ currentTime: 0, isPlaying: true });
      return;
    }
    let nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeat === "all") {
        nextIndex = 0;
      } else {
        set({ isPlaying: false });
        return;
      }
    }
    set({ currentIndex: nextIndex, currentTrack: queue[nextIndex], currentTime: 0, duration: queue[nextIndex].duration, isPlaying: true });
  },

  prev: () => {
    const { queue, currentIndex, currentTime } = get();
    if (queue.length === 0) return;
    if (currentTime > 3) {
      audioEngine.seek(0);
      set({ currentTime: 0 });
      return;
    }
    const prevIndex = currentIndex - 1 < 0 ? queue.length - 1 : currentIndex - 1;
    set({ currentIndex: prevIndex, currentTrack: queue[prevIndex], currentTime: 0, duration: queue[prevIndex].duration, isPlaying: true });
  },

  getNextIndex: () => {
    const { queue, currentIndex } = get();
    if (queue.length === 0) return null;
    const repeat = useSettingsStore.getState().repeat;
    if (repeat === "one") return null;
    let n = currentIndex + 1;
    if (n >= queue.length) {
      if (repeat === "all") n = 0;
      else return null;
    }
    return n;
  },

  jumpTo: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({ currentIndex: index, currentTrack: queue[index], currentTime: 0, duration: queue[index].duration, isPlaying: true });
  },

  playNext: (tracks) => {
    if (tracks.length === 0) return;
    const { queue, currentIndex, currentTrack } = get();
    if (!currentTrack) {
      get().playQueue(tracks, 0);
      return;
    }
    const next = [...queue];
    next.splice(currentIndex + 1, 0, ...tracks);
    set({ queue: next });
  },

  addToQueue: (tracks) => {
    if (tracks.length === 0) return;
    const { queue, currentTrack } = get();
    if (!currentTrack) {
      get().playQueue(tracks, 0);
      return;
    }
    set({ queue: [...queue, ...tracks] });
  },

  reorderQueue: (fromIndex, toIndex) => {
    const { queue, currentTrack } = get();
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= queue.length || toIndex >= queue.length) return;
    const next = [...queue];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const newIndex = currentTrack ? next.findIndex((t) => t.id === currentTrack.id) : -1;
    set({ queue: next, currentIndex: newIndex });
  },

  removeFromQueue: (index) => {
    const { queue, currentIndex } = get();
    if (index < 0 || index >= queue.length) return;
    const next = queue.filter((_, i) => i !== index);
    if (next.length === 0) {
      // Removing the last song must stop it, same as clearing the queue.
      get().clearQueue();
      return;
    }
    if (index < currentIndex) {
      set({ queue: next, currentIndex: currentIndex - 1 });
    } else if (index > currentIndex) {
      set({ queue: next, currentIndex });
    } else {
      const newIndex = Math.min(currentIndex, next.length - 1);
      set({ queue: next, currentIndex: newIndex, currentTrack: next[newIndex], currentTime: 0 });
    }
  },

  clearQueue: () => {
    audioEngine.pause();
    clearLastPlayback();
    set({ queue: [], currentIndex: -1, currentTrack: null, isPlaying: false, currentTime: 0, duration: 0 });
  },

  seekTo: (time) => set({ currentTime: time }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setResolvingId: (resolvingId) => set({ resolvingId }),

  toggleShuffle: () => {
    const settings = useSettingsStore.getState();
    settings.setShuffle(!settings.shuffle);
  },
}));
