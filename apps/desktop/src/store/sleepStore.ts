import { create } from "zustand";

interface SleepState {
  endsAt: number | null;
  remainingMs: number;
  start: (minutes: number) => void;
  cancel: () => void;
  tick: () => boolean;
}

export const useSleepStore = create<SleepState>((set, get) => ({
  endsAt: null,
  remainingMs: 0,

  start: (minutes: number) => {
    const endsAt = Date.now() + minutes * 60_000;
    set({ endsAt, remainingMs: minutes * 60_000 });
  },

  cancel: () => set({ endsAt: null, remainingMs: 0 }),

  // Returns true on the tick where the timer elapses.
  tick: () => {
    const { endsAt } = get();
    if (endsAt === null) return false;
    const remainingMs = endsAt - Date.now();
    if (remainingMs <= 0) {
      set({ endsAt: null, remainingMs: 0 });
      return true;
    }
    set({ remainingMs });
    return false;
  },
}));
