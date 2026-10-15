import type { Track as CoreTrack } from "@musicvault/core";

export type {
  AccentColor,
  EqBand,
  LyricLine,
  Playlist,
  RepeatMode,
  RuleCondition,
  RuleField,
  RuleGroup,
  RuleNode,
  RuleTrackInput,
  Settings,
  SmartRules,
  ThemeMode,
} from "@musicvault/core";
export { EQ_FREQS, EQ_PRESETS } from "@musicvault/core";

/**
 * Web track: core metadata plus cloud-storage fields. `id` IS the canonical
 * Supabase tracks.id — the web library is the synced index itself, so no
 * local/remote id mapping exists on this client.
 */
export interface Track extends CoreTrack {
  codec?: string;
  bitDepth?: number;
  channels?: number;
  /** Audio bytes present in the OPFS auto-cache. */
  cached?: boolean;
  /** Explicitly downloaded (pinned — never auto-evicted). */
  pinned?: boolean;
  /** R2 object key of the audio; set when the track is in the vault. */
  storageKey?: string;
  /** R2 object key of the online cover. */
  artworkKey?: string;
}
