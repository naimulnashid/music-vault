import { create } from "zustand";
import type { AccentColor, RepeatMode, Settings, ThemeMode } from "../types";
import { EQ_PRESETS } from "../types";
import * as db from "../lib/db";
import { nowIso, syncEnqueue } from "../lib/syncBus";
import { useAuthStore } from "./authStore";

const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  theme: "dark",
  accent: "purple",
  eqPreset: "Flat",
  eqBands: EQ_PRESETS.Flat,
  volume: 0.8,
  shuffle: false,
  repeat: "off",
  gapless: true,
  crossfadeDuration: 0,
  notificationsEnabled: false,
};

/**
 * Which settings sync account-wide vs per-device. Volume and EQ follow the
 * speakers, not the account; everything else is a preference that should look
 * the same on every client. (Same split as desktop.)
 */
const GLOBAL_KEYS = new Set<keyof Settings>([
  "theme",
  "accent",
  "shuffle",
  "repeat",
  "gapless",
  "crossfadeDuration",
  "notificationsEnabled",
]);
const DEVICE_KEYS = new Set<keyof Settings>(["volume", "eqPreset", "eqBands"]);

function pushSetting(key: keyof Settings, value: Settings[keyof Settings]) {
  let scope: string;
  if (GLOBAL_KEYS.has(key)) {
    scope = "global";
  } else if (DEVICE_KEYS.has(key)) {
    const deviceId = useAuthStore.getState().deviceId;
    if (!deviceId) return; // device not registered yet — stays local
    scope = deviceId;
  } else {
    return;
  }
  syncEnqueue({ kind: "setting.set", scope, key, value: value as never, editedAt: nowIso() });
}

/** Mirrors the theme choices into localStorage for the pre-hydration boot script. */
function mirrorTheme(state: Settings) {
  try {
    localStorage.setItem("mv.theme", state.theme);
    localStorage.setItem("mv.followSystem", state.followSystemTheme ? "1" : "0");
    localStorage.setItem("mv.amoled", state.amoled ? "1" : "0");
    localStorage.removeItem("mv.accent");
  } catch {
    // Ignore storage failures.
  }
}

interface SettingsState extends Settings {
  loaded: boolean;
  loadSettings: () => Promise<void>;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: AccentColor) => void;
  setEqPreset: (preset: string) => void;
  setEqBands: (bands: number[]) => void;
  setVolume: (volume: number) => void;
  setShuffle: (shuffle: boolean) => void;
  setRepeat: (repeat: RepeatMode) => void;
  setGapless: (gapless: boolean) => void;
  setCrossfadeDuration: (seconds: number) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  /** Device-local (not synced), like desktop: pure black in dark theme. */
  setAmoled: (amoled: boolean) => void;
  /** Device-local: follow the OS light/dark setting. */
  setFollowSystemTheme: (follow: boolean) => void;
  /** Sync engine pull: applies without re-enqueueing (remote already knows). */
  applyRemoteSetting: (scope: string, key: string, value: unknown) => void;
}

function persist(state: Settings) {
  void db.putSettings(state);
  mirrorTheme(state);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    try {
      const saved = await db.getSettings();
      if (saved) {
        // Merge over defaults so settings added in later versions get sane values.
        set({ ...DEFAULT_SETTINGS, ...saved, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch (err) {
      console.error("[settings] load failed, using defaults:", err);
      set({ loaded: true });
    }
  },

  setTheme: (theme) => {
    set({ theme });
    persist({ ...extractSettings(get()), theme });
    pushSetting("theme", theme);
  },
  setAccent: (accent) => {
    set({ accent });
    persist({ ...extractSettings(get()), accent });
    pushSetting("accent", accent);
  },
  setEqPreset: (eqPreset) => {
    const eqBands = EQ_PRESETS[eqPreset] ?? get().eqBands;
    set({ eqPreset, eqBands });
    persist({ ...extractSettings(get()), eqPreset, eqBands });
    pushSetting("eqPreset", eqPreset);
    pushSetting("eqBands", eqBands);
  },
  setEqBands: (eqBands) => {
    set({ eqBands, eqPreset: "Custom" });
    persist({ ...extractSettings(get()), eqBands, eqPreset: "Custom" });
    pushSetting("eqPreset", "Custom");
    pushSetting("eqBands", eqBands);
  },
  setVolume: (volume) => {
    set({ volume });
    persist({ ...extractSettings(get()), volume });
    pushSetting("volume", volume);
  },
  setShuffle: (shuffle) => {
    set({ shuffle });
    persist({ ...extractSettings(get()), shuffle });
    pushSetting("shuffle", shuffle);
  },
  setRepeat: (repeat) => {
    set({ repeat });
    persist({ ...extractSettings(get()), repeat });
    pushSetting("repeat", repeat);
  },
  setGapless: (gapless) => {
    set({ gapless });
    persist({ ...extractSettings(get()), gapless });
    pushSetting("gapless", gapless);
  },
  setCrossfadeDuration: (crossfadeDuration) => {
    set({ crossfadeDuration });
    persist({ ...extractSettings(get()), crossfadeDuration });
    pushSetting("crossfadeDuration", crossfadeDuration);
  },
  setNotificationsEnabled: (notificationsEnabled) => {
    set({ notificationsEnabled });
    persist({ ...extractSettings(get()), notificationsEnabled });
    pushSetting("notificationsEnabled", notificationsEnabled);
  },

  setAmoled: (amoled) => {
    set({ amoled });
    persist({ ...extractSettings(get()), amoled });
  },
  setFollowSystemTheme: (followSystemTheme) => {
    set({ followSystemTheme });
    persist({ ...extractSettings(get()), followSystemTheme });
  },

  applyRemoteSetting: (scope, key, value) => {
    if (scope !== "global" && scope !== useAuthStore.getState().deviceId) return;
    const k = key as keyof Settings;
    if (!GLOBAL_KEYS.has(k) && !DEVICE_KEYS.has(k)) return;
    if (JSON.stringify(get()[k]) === JSON.stringify(value)) return;
    set({ [k]: value } as Partial<SettingsState>);
    persist(extractSettings(get()));
  },
}));

function extractSettings(state: SettingsState): Settings {
  const {
    id,
    theme,
    accent,
    eqPreset,
    eqBands,
    volume,
    shuffle,
    repeat,
    gapless,
    crossfadeDuration,
    notificationsEnabled,
    amoled,
    followSystemTheme,
  } = state;
  return {
    id,
    theme,
    accent,
    eqPreset,
    eqBands,
    volume,
    shuffle,
    repeat,
    gapless,
    crossfadeDuration,
    notificationsEnabled,
    amoled,
    followSystemTheme,
  };
}
