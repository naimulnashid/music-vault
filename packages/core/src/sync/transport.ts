import type { MusicVaultClient } from "../supabase/client";
import type { TrackEditPatch } from "../trackFields";
import type {
  FavoriteRow,
  PlayEventRow,
  PlaylistItemRow,
  PlaylistRow,
  QueueStateRow,
  RatingRow,
  SettingRow,
  TrackRow,
} from "../supabase/database.types";

/**
 * Server I/O boundary of the sync engine. The production implementation is
 * {@link SupabaseTransport}; tests drive the engine against an in-memory fake
 * server so two simulated devices can conflict deterministically.
 *
 * pull* methods return rows with `updated_at` (`created_at` for play_events)
 * strictly greater than `since`, ascending; `since = null` means everything.
 */
export interface SyncTransport {
  pullTracks(since: string | null): Promise<TrackRow[]>;
  pullPlaylists(since: string | null): Promise<PlaylistRow[]>;
  pullPlaylistItems(since: string | null): Promise<PlaylistItemRow[]>;
  pullFavorites(since: string | null): Promise<FavoriteRow[]>;
  pullRatings(since: string | null): Promise<RatingRow[]>;
  pullSettings(since: string | null): Promise<SettingRow[]>;
  pullQueueState(): Promise<QueueStateRow | null>;
  pullPlayEvents(since: string | null): Promise<PlayEventRow[]>;

  /** Lookup by content hash for TrackRef resolution. */
  getTrackByHash(contentHash: string): Promise<TrackRow | null>;
  /** Creates a minimal canonical row for a track no device has published yet. */
  insertTrack(row: TrackInsertMinimal): Promise<TrackRow>;
  /**
   * Field-level LWW edit (`apply_track_edit`). Returns the row as stored
   * afterwards, or null when the track no longer exists (deleted/not owned).
   */
  applyTrackEdit(trackId: string, patch: TrackEditPatch, editedAt: string): Promise<TrackRow | null>;

  getFavorite(trackId: string): Promise<FavoriteRow | null>;
  upsertFavorite(row: { track_id: string; favorite: boolean; edited_at: string }): Promise<void>;

  getRating(trackId: string): Promise<RatingRow | null>;
  upsertRating(row: { track_id: string; rating: number; edited_at: string }): Promise<void>;

  getPlaylist(id: string): Promise<PlaylistRow | null>;
  upsertPlaylist(row: PlaylistUpsert): Promise<void>;

  getPlaylistItems(playlistId: string): Promise<PlaylistItemRow[]>;
  upsertPlaylistItem(row: PlaylistItemUpsert): Promise<void>;

  getSetting(scope: string, key: string): Promise<SettingRow | null>;
  upsertSetting(row: { scope: string; key: string; value: unknown; edited_at: string }): Promise<void>;

  upsertQueueState(row: QueueStateUpsert): Promise<void>;

  /** Append-only, idempotent on the client-generated id. */
  insertPlayEvent(row: PlayEventInsert): Promise<void>;

  /**
   * Realtime "pull sooner" hint. Calls onChange on any change to the synced
   * tables for this user; returns an unsubscribe. Optional (fake transports
   * may trigger it manually).
   */
  subscribe(onChange: () => void): () => void;
}

export interface TrackInsertMinimal {
  content_hash: string;
  file_name: string;
  file_size: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export interface PlaylistUpsert {
  id: string;
  parent_id: string | null;
  name: string;
  is_folder: boolean;
  is_smart: boolean;
  smart_rules: unknown;
  position: string;
  edited_at: string;
  deleted_at: string | null;
}

export interface PlaylistItemUpsert {
  playlist_id: string;
  track_id: string;
  position: string;
  edited_at: string;
  deleted_at: string | null;
}

export interface QueueStateUpsert {
  device_id: string | null;
  track_ids: string[];
  current_index: number;
  position_seconds: number;
  shuffle: boolean;
  repeat: string;
  edited_at: string;
}

export interface PlayEventInsert {
  id: string;
  track_id: string;
  device_id: string | null;
  played_at: string;
  duration_played: number;
  completed: boolean;
}

/** Connectivity failure — the flush stops and everything stays queued. */
export class SyncNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncNetworkError";
  }
}

const SYNCED_TABLES = [
  "tracks",
  "playlists",
  "playlist_items",
  "favorites",
  "ratings",
  "settings",
  "queue_state",
  "play_events",
] as const;

function classify(error: { message: string }): Error {
  // supabase-js surfaces fetch-level failures as a message, not a code.
  if (/fetch|network|abort|timeout|ENOTFOUND|ECONN/i.test(error.message)) {
    return new SyncNetworkError(error.message);
  }
  return new Error(error.message);
}

/** Rows per pull request — Supabase's default PostgREST response cap. */
const PULL_PAGE = 1000;

export class SupabaseTransport implements SyncTransport {
  private readonly client: MusicVaultClient;
  private readonly userId: string;

  constructor(client: MusicVaultClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }

  /**
   * Every row changed after `since`, oldest first. Paged: PostgREST caps one
   * response (1,000 rows on Supabase), and a full pull must see every row —
   * the engine prunes the tracks shadow to exactly what it returns. `tiebreak`
   * (the primary key) keeps the order stable across pages when timestamps tie.
   */
  private async pull<T>(table: string, cursorColumn: string, tiebreak: string[], since: string | null): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PULL_PAGE) {
      let query = this.client
        .from(table as "tracks")
        .select("*")
        .order(cursorColumn as "updated_at", { ascending: true });
      for (const column of tiebreak) query = query.order(column as "id", { ascending: true });
      if (since !== null) query = query.gt(cursorColumn as "updated_at", since);
      const { data, error } = await query.range(from, from + PULL_PAGE - 1);
      if (error) throw classify(error);
      const page = (data ?? []) as T[];
      out.push(...page);
      if (page.length < PULL_PAGE) return out;
    }
  }

  pullTracks(since: string | null) {
    return this.pull<TrackRow>("tracks", "updated_at", ["id"], since);
  }
  pullPlaylists(since: string | null) {
    return this.pull<PlaylistRow>("playlists", "updated_at", ["id"], since);
  }
  pullPlaylistItems(since: string | null) {
    return this.pull<PlaylistItemRow>("playlist_items", "updated_at", ["id"], since);
  }
  pullFavorites(since: string | null) {
    return this.pull<FavoriteRow>("favorites", "updated_at", ["track_id"], since);
  }
  pullRatings(since: string | null) {
    return this.pull<RatingRow>("ratings", "updated_at", ["track_id"], since);
  }
  pullSettings(since: string | null) {
    return this.pull<SettingRow>("settings", "updated_at", ["scope", "key"], since);
  }
  pullPlayEvents(since: string | null) {
    return this.pull<PlayEventRow>("play_events", "created_at", ["id"], since);
  }

  async pullQueueState(): Promise<QueueStateRow | null> {
    const { data, error } = await this.client.from("queue_state").select("*").maybeSingle();
    if (error) throw classify(error);
    return data;
  }

  async getTrackByHash(contentHash: string): Promise<TrackRow | null> {
    const { data, error } = await this.client
      .from("tracks")
      .select("*")
      .eq("content_hash", contentHash)
      .maybeSingle();
    if (error) throw classify(error);
    return data;
  }

  async insertTrack(row: TrackInsertMinimal): Promise<TrackRow> {
    // Upsert on the content-hash index so two devices racing to create the
    // same track converge on one row.
    const { data, error } = await this.client
      .from("tracks")
      .upsert({ user_id: this.userId, ...row }, { onConflict: "user_id,content_hash" })
      .select()
      .single();
    if (error) throw classify(error);
    return data;
  }

  async applyTrackEdit(trackId: string, patch: TrackEditPatch, editedAt: string): Promise<TrackRow | null> {
    const { data, error } = await this.client.rpc("apply_track_edit", {
      p_track_id: trackId,
      p_patch: patch as never,
      p_edited_at: editedAt,
    });
    if (error) {
      if (error.code === "P0002") return null; // deleted or not ours: nothing to edit
      throw classify(error);
    }
    return data as TrackRow;
  }

  async getFavorite(trackId: string): Promise<FavoriteRow | null> {
    const { data, error } = await this.client
      .from("favorites")
      .select("*")
      .eq("track_id", trackId)
      .maybeSingle();
    if (error) throw classify(error);
    return data;
  }

  async upsertFavorite(row: { track_id: string; favorite: boolean; edited_at: string }): Promise<void> {
    const { error } = await this.client
      .from("favorites")
      .upsert({ user_id: this.userId, ...row }, { onConflict: "user_id,track_id" });
    if (error) throw classify(error);
  }

  async getRating(trackId: string): Promise<RatingRow | null> {
    const { data, error } = await this.client
      .from("ratings")
      .select("*")
      .eq("track_id", trackId)
      .maybeSingle();
    if (error) throw classify(error);
    return data;
  }

  async upsertRating(row: { track_id: string; rating: number; edited_at: string }): Promise<void> {
    const { error } = await this.client
      .from("ratings")
      .upsert({ user_id: this.userId, ...row }, { onConflict: "user_id,track_id" });
    if (error) throw classify(error);
  }

  async getPlaylist(id: string): Promise<PlaylistRow | null> {
    const { data, error } = await this.client.from("playlists").select("*").eq("id", id).maybeSingle();
    if (error) throw classify(error);
    return data;
  }

  async upsertPlaylist(row: PlaylistUpsert): Promise<void> {
    const { error } = await this.client
      .from("playlists")
      .upsert({ user_id: this.userId, ...row, smart_rules: row.smart_rules as never });
    if (error) throw classify(error);
  }

  async getPlaylistItems(playlistId: string): Promise<PlaylistItemRow[]> {
    const { data, error } = await this.client
      .from("playlist_items")
      .select("*")
      .eq("playlist_id", playlistId);
    if (error) throw classify(error);
    return data ?? [];
  }

  async upsertPlaylistItem(row: PlaylistItemUpsert): Promise<void> {
    const { error } = await this.client
      .from("playlist_items")
      .upsert({ user_id: this.userId, ...row }, { onConflict: "playlist_id,track_id" });
    if (error) throw classify(error);
  }

  async getSetting(scope: string, key: string): Promise<SettingRow | null> {
    const { data, error } = await this.client
      .from("settings")
      .select("*")
      .eq("scope", scope)
      .eq("key", key)
      .maybeSingle();
    if (error) throw classify(error);
    return data;
  }

  async upsertSetting(row: { scope: string; key: string; value: unknown; edited_at: string }): Promise<void> {
    const { error } = await this.client
      .from("settings")
      .upsert(
        { user_id: this.userId, ...row, value: row.value as never },
        { onConflict: "user_id,scope,key" },
      );
    if (error) throw classify(error);
  }

  async upsertQueueState(row: QueueStateUpsert): Promise<void> {
    const { error } = await this.client
      .from("queue_state")
      .upsert({ user_id: this.userId, ...row, repeat: row.repeat as "off" });
    if (error) throw classify(error);
  }

  async insertPlayEvent(row: PlayEventInsert): Promise<void> {
    const { error } = await this.client
      .from("play_events")
      .upsert({ user_id: this.userId, ...row }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw classify(error);
  }

  subscribe(onChange: () => void): () => void {
    const channel = this.client.channel(`sync-${this.userId}`);
    for (const table of SYNCED_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `user_id=eq.${this.userId}` },
        onChange,
      );
    }
    channel.subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
