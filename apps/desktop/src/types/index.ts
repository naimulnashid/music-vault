import type { Track as CoreTrack } from "@musicvault/core";

export type {
  AccentColor,
  EqBand,
  LyricLine,
  Playlist,
  RepeatMode,
  ReplayGainMode,
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

/** Desktop track: a vault track (core metadata plus vault and cache fields). */
export interface Track extends CoreTrack {
  /**
   * Local path of the downloaded audio (cache or pinned download). Empty until
   * the play resolver has fetched the track from the vault.
   */
  path: string;
  bitDepth?: number;
  channels?: number;
  codec?: string;
  /** Filename inside the app's artwork cache directory. */
  artworkPath?: string;
  /** Supabase tracks.id. */
  remoteId?: string;
  /** R2 object key of the audio. */
  storageKey?: string;
  /** R2 object key of the online cover. */
  artworkKey?: string;
}
