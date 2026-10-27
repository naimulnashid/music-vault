import type { SmartRules } from "./smartRules";

export interface LyricLine {
  time: number;
  text: string;
}

/**
 * Platform-independent track metadata. Each client extends this with its own
 * storage fields (desktop: absolute path + artwork cache file; web: blobs;
 * Android mirrors it in Kotlin).
 */
export interface Track {
  /** Stable identifier. Today per-client; becomes the canonical cross-device id in Phase 3. */
  id: string;
  fileName: string;
  fileSize: number;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  /** Follows releaseDate. */
  year?: number;
  language?: string;
  country?: string;
  /** Guest artists, comma-separated. */
  featuredArtists?: string;
  subgenre?: string;
  /** Comma-separated. */
  secondaryGenres?: string;
  /** Comma-separated. */
  mood?: string;
  vocals?: string;
  /** "2019", "2019-05" or "2019-05-14". */
  releaseDate?: string;
  composer?: string;
  trackNo?: number;
  discNo?: number;
  bpm?: number;
  duration: number;
  /** Sample rate tagged in the source file, in Hz (e.g. 44100). */
  sampleRate?: number;
  /** ReplayGain gain values in dB, as tagged in the file. */
  replayGainTrack?: number;
  replayGainAlbum?: number;
  /** Star rating 1–5; 0 or undefined = unrated. */
  rating?: number;
  /** BLAKE3 hash of the file bytes — cross-device identity for local files (Phase 3). */
  contentHash?: string;
  lyricsText?: string;
  lyricsSynced?: LyricLine[];
  addedAt: number;
  favorite?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  /** Manual playlists only; smart playlists compute their tracks from rules. */
  trackIds: string[];
  createdAt: number;
  isSmart?: boolean;
  smartRules?: SmartRules;
}

export type RepeatMode = "off" | "one" | "all";

/** ReplayGain playback mode (desktop Rust engine, Phase 8). */
export type ReplayGainMode = "off" | "track" | "album";

export type ThemeMode = "dark" | "light";

/** Named accent presets shared by every client. */
export type AccentPreset = "purple" | "blue" | "green" | "pink";
/**
 * Accent setting value: a named preset or a custom "#rrggbb" hex (Phase 8).
 * Clients that only understand presets fall back to their default accent
 * when they receive a hex value.
 */
export type AccentColor = AccentPreset | (string & {});

/** Hex values behind the named presets (single source of truth for pickers). */
export const ACCENT_PRESETS: Record<AccentPreset, string> = {
  purple: "#a855f7",
  blue: "#3b82f6",
  green: "#22c55e",
  pink: "#ec4899",
};

export interface EqBand {
  freq: number;
  gain: number;
}

export interface Settings {
  id: "settings";
  theme: ThemeMode;
  accent: AccentColor;
  eqPreset: string;
  eqBands: number[];
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  gapless: boolean;
  crossfadeDuration: number;
  notificationsEnabled: boolean;
  /** ReplayGain volume normalization (synced; only desktop applies it). */
  replayGainMode?: ReplayGainMode;
  /** Pure-black dark theme (device-local, never synced). */
  amoled?: boolean;
  /** Follow the OS light/dark preference (device-local, never synced). */
  followSystemTheme?: boolean;
}

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass Boost": [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  Vocal: [-2, -2, -1, 2, 4, 4, 3, 1, 0, -1],
  "Treble Boost": [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
};
