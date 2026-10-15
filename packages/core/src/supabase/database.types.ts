/**
 * Hand-written Database types matching supabase/migrations/0001–0004.
 * Once a live project exists these can be regenerated with
 * `supabase gen types typescript`, but the shape must stay identical.
 */

import type { LyricLine, RepeatMode } from "../types";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ProfileRow = {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export type DevicePlatform = "desktop" | "android" | "web";

export type DeviceRow = {
  id: string;
  user_id: string;
  name: string;
  platform: DevicePlatform;
  created_at: string;
  last_seen_at: string;
}

export type TrackRow = {
  id: string;
  user_id: string;
  content_hash: string | null;
  file_name: string;
  file_size: number;
  title: string;
  artist: string;
  album: string;
  genre: string | null;
  language: string | null;
  country: string | null;
  /** "2019", "2019-05" or "2019-05-14" (0006). */
  release_date: string | null;
  /** Follows release_date (a trigger keeps it in step). */
  year: number | null;
  /** Legacy tag columns: no longer edited, uploaded or shown (0006). */
  album_artist: string | null;
  composer: string | null;
  track_no: number | null;
  disc_no: number | null;
  bpm: number | null;
  replaygain_track_db: number | null;
  replaygain_album_db: number | null;
  duration: number;
  codec: string | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  lyrics_text: string | null;
  lyrics_synced: LyricLine[] | null;
  /** R2 object key of the audio; null = not in the vault (0004). */
  storage_key: string | null;
  uploaded_at: string | null;
  /** R2 object key of the full-size cover (the thumb key is derived). */
  artwork_key: string | null;
  /** Per-field edit clock for field-level LWW: { title: "<iso>", … }. */
  field_edited_at: Record<string, string>;
  /** Tombstone: rows are never hard-deleted by the app. */
  deleted_at: string | null;
  /** On a merge tombstone, the row that absorbed this one's history. */
  merged_into: string | null;
  created_at: string;
  updated_at: string;
}

export type PlaylistRow = {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  is_folder: boolean;
  is_smart: boolean;
  smart_rules: Json | null;
  position: string;
  edited_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PlaylistItemRow = {
  id: string;
  user_id: string;
  playlist_id: string;
  track_id: string;
  position: string;
  edited_at: string;
  deleted_at: string | null;
  added_at: string;
  updated_at: string;
}

export type FavoriteRow = {
  user_id: string;
  track_id: string;
  favorite: boolean;
  edited_at: string;
  created_at: string;
  updated_at: string;
}

export type RatingRow = {
  user_id: string;
  track_id: string;
  /** 1–5 stars; 0 = cleared. */
  rating: number;
  edited_at: string;
  updated_at: string;
}

export type PlayEventRow = {
  id: string;
  user_id: string;
  track_id: string;
  device_id: string | null;
  played_at: string;
  duration_played: number;
  completed: boolean;
  /** Server receive time — the pull cursor for this append-only table. */
  created_at: string;
}

export type SettingRow = {
  user_id: string;
  scope: string;
  key: string;
  value: Json;
  edited_at: string;
  updated_at: string;
}

export type QueueStateRow = {
  user_id: string;
  device_id: string | null;
  track_ids: string[];
  current_index: number;
  position_seconds: number;
  shuffle: boolean;
  repeat: RepeatMode;
  edited_at: string;
  updated_at: string;
}

type WithDefaults<Row, Defaulted extends keyof Row> = Omit<Row, Defaulted> & Partial<Pick<Row, Defaulted>>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: WithDefaults<ProfileRow, "display_name" | "created_at" | "updated_at">;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      devices: {
        Row: DeviceRow;
        Insert: WithDefaults<DeviceRow, "id" | "created_at" | "last_seen_at">;
        Update: Partial<DeviceRow>;
        Relationships: [];
      };
      tracks: {
        Row: TrackRow;
        Insert: WithDefaults<
          TrackRow,
          | "id"
          | "content_hash"
          | "file_size"
          | "artist"
          | "album"
          | "album_artist"
          | "genre"
          | "year"
          | "language"
          | "country"
          | "release_date"
          | "composer"
          | "track_no"
          | "disc_no"
          | "bpm"
          | "replaygain_track_db"
          | "replaygain_album_db"
          | "duration"
          | "codec"
          | "sample_rate"
          | "bit_depth"
          | "channels"
          | "lyrics_text"
          | "lyrics_synced"
          | "storage_key"
          | "uploaded_at"
          | "artwork_key"
          | "field_edited_at"
          | "deleted_at"
          | "merged_into"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<TrackRow>;
        Relationships: [];
      };
      playlists: {
        Row: PlaylistRow;
        Insert: WithDefaults<
          PlaylistRow,
          | "id"
          | "parent_id"
          | "is_folder"
          | "is_smart"
          | "smart_rules"
          | "position"
          | "edited_at"
          | "deleted_at"
          | "created_at"
          | "updated_at"
        >;
        Update: Partial<PlaylistRow>;
        Relationships: [];
      };
      playlist_items: {
        Row: PlaylistItemRow;
        Insert: WithDefaults<
          PlaylistItemRow,
          "id" | "position" | "edited_at" | "deleted_at" | "added_at" | "updated_at"
        >;
        Update: Partial<PlaylistItemRow>;
        Relationships: [];
      };
      favorites: {
        Row: FavoriteRow;
        Insert: WithDefaults<FavoriteRow, "favorite" | "edited_at" | "created_at" | "updated_at">;
        Update: Partial<FavoriteRow>;
        Relationships: [];
      };
      ratings: {
        Row: RatingRow;
        Insert: WithDefaults<RatingRow, "edited_at" | "updated_at">;
        Update: Partial<RatingRow>;
        Relationships: [];
      };
      play_events: {
        Row: PlayEventRow;
        Insert: WithDefaults<
          PlayEventRow,
          "device_id" | "played_at" | "duration_played" | "completed" | "created_at"
        >;
        Update: never;
        Relationships: [];
      };
      settings: {
        Row: SettingRow;
        Insert: WithDefaults<SettingRow, "scope" | "edited_at" | "updated_at">;
        Update: Partial<SettingRow>;
        Relationships: [];
      };
      queue_state: {
        Row: QueueStateRow;
        Insert: WithDefaults<
          QueueStateRow,
          | "device_id"
          | "track_ids"
          | "current_index"
          | "position_seconds"
          | "shuffle"
          | "repeat"
          | "edited_at"
          | "updated_at"
        >;
        Update: Partial<QueueStateRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      apply_track_edit: {
        Args: { p_track_id: string; p_patch: Json; p_edited_at: string };
        Returns: TrackRow;
      };
      resolve_upload_target: {
        /** p_md5 is accepted and ignored (pre-M7 clients still send it). */
        Args: { p_content_hash: string; p_md5?: string | null };
        Returns: string | null;
      };
      merge_tracks: {
        Args: { p_keep: string; p_drop: string };
        Returns: string;
      };
      delete_track: {
        Args: { p_track_id: string };
        Returns: { storage_key: string | null; artwork_key: string | null; artwork_still_used: boolean }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
