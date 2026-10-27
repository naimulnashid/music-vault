package com.musicvault.data.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Server I/O boundary of the sync engine — Kotlin port of
 * packages/core/src/sync/transport.ts. The production implementation is
 * [SupabaseSyncTransport]; tests drive the engine against an in-memory fake
 * server so two simulated devices can conflict deterministically.
 *
 * pull* methods return rows with `updated_at` (`created_at` for play_events)
 * strictly greater than `since`, ascending; `since = null` means everything.
 */
interface SyncTransport {
    suspend fun pullTracks(since: String?): List<TrackRow>
    suspend fun pullPlaylists(since: String?): List<PlaylistRow>
    suspend fun pullPlaylistItems(since: String?): List<PlaylistItemRow>
    suspend fun pullFavorites(since: String?): List<FavoriteRow>
    suspend fun pullRatings(since: String?): List<RatingRow>
    suspend fun pullSettings(since: String?): List<SettingRow>
    suspend fun pullQueueState(): QueueStateRow?
    suspend fun pullPlayEvents(since: String?): List<PlayEventRow>

    /** Lookup by content hash for TrackRef resolution. */
    suspend fun getTrackByHash(contentHash: String): TrackRow?

    /** Creates a minimal canonical row for a track no device has published yet. */
    suspend fun insertTrack(row: TrackInsertMinimal): TrackRow

    /**
     * Field-level LWW edit (`apply_track_edit`). Returns the row as stored
     * afterwards, or null when the track no longer exists (deleted/not owned).
     */
    suspend fun applyTrackEdit(trackId: String, patch: JsonObject, editedAt: String): TrackRow?

    suspend fun getFavorite(trackId: String): FavoriteRow?
    suspend fun upsertFavorite(trackId: String, favorite: Boolean, editedAt: String)

    suspend fun getRating(trackId: String): RatingRow?
    suspend fun upsertRating(trackId: String, rating: Int, editedAt: String)

    suspend fun getPlaylist(id: String): PlaylistRow?
    suspend fun upsertPlaylist(row: PlaylistUpsert)

    suspend fun getPlaylistItems(playlistId: String): List<PlaylistItemRow>
    suspend fun upsertPlaylistItem(row: PlaylistItemUpsert)

    suspend fun getSetting(scope: String, key: String): SettingRow?
    suspend fun upsertSetting(scope: String, key: String, value: JsonElement, editedAt: String)

    suspend fun upsertQueueState(row: QueueStateUpsert)

    /** Append-only, idempotent on the client-generated id. */
    suspend fun insertPlayEvent(row: PlayEventInsert)

    /**
     * Realtime "pull sooner" hint. Calls onChange on any change to the synced
     * tables for this user; returns an unsubscribe.
     */
    fun subscribe(onChange: () -> Unit): () -> Unit

    /**
     * Asks the auth layer for a fresh access token after a [SyncAuthException].
     * Throws [SyncNetworkException] when offline; any other failure means the
     * session can't be renewed without signing in again.
     */
    suspend fun refreshAuth()
}

/** Connectivity failure — the flush stops and everything stays queued. */
class SyncNetworkException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The server rejected the session (HTTP 401, PGRST301, JWT expired) or there
 * is no session to send. Not the op's fault: it stays queued without an
 * attempt bump while the engine refreshes or waits for a sign-in.
 */
class SyncAuthException(message: String, cause: Throwable? = null) : Exception(message, cause)

// ---- Remote row shapes (Supabase column names) -------------------------------

@Serializable
data class TrackRow(
    val id: String,
    @SerialName("user_id") val userId: String = "",
    @SerialName("content_hash") val contentHash: String? = null,
    @SerialName("file_name") val fileName: String = "",
    @SerialName("file_size") val fileSize: Long = 0,
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val genre: String? = null,
    val language: String? = null,
    val country: String? = null,
    /** Guest artists, comma-separated (0010). */
    @SerialName("featured_artists") val featuredArtists: String? = null,
    val subgenre: String? = null,
    /** Comma-separated (0010). */
    @SerialName("secondary_genres") val secondaryGenres: String? = null,
    /** Comma-separated (0010). */
    val mood: String? = null,
    val vocals: String? = null,
    /** "2019", "2019-05" or "2019-05-14" (0006). */
    @SerialName("release_date") val releaseDate: String? = null,
    /** Follows releaseDate (a server trigger keeps it in step). */
    val year: Int? = null,
    /** Legacy tag columns: no longer edited, uploaded or shown (0006). */
    @SerialName("album_artist") val albumArtist: String? = null,
    val composer: String? = null,
    @SerialName("track_no") val trackNo: Int? = null,
    @SerialName("disc_no") val discNo: Int? = null,
    val bpm: Double? = null,
    @SerialName("replaygain_track_db") val replaygainTrackDb: Double? = null,
    @SerialName("replaygain_album_db") val replaygainAlbumDb: Double? = null,
    val duration: Double = 0.0,
    val codec: String? = null,
    @SerialName("sample_rate") val sampleRate: Int? = null,
    @SerialName("bit_depth") val bitDepth: Int? = null,
    val channels: Int? = null,
    @SerialName("lyrics_text") val lyricsText: String? = null,
    @SerialName("lyrics_synced") val lyricsSynced: JsonElement? = null,
    /** R2 object key of the audio; null = not in the vault (0004_vault.sql). */
    @SerialName("storage_key") val storageKey: String? = null,
    @SerialName("uploaded_at") val uploadedAt: String? = null,
    /** R2 object key of the full-size cover (the thumb key is derived). */
    @SerialName("artwork_key") val artworkKey: String? = null,
    /** Per-field edit clock for field-level LWW: { "title": "<iso>", … }. */
    @SerialName("field_edited_at") val fieldEditedAt: Map<String, String> = emptyMap(),
    /** Tombstone: rows are never hard-deleted by the app. */
    @SerialName("deleted_at") val deletedAt: String? = null,
    /** On a merge tombstone, the row that absorbed this one's history. */
    @SerialName("merged_into") val mergedInto: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class FavoriteRow(
    @SerialName("track_id") val trackId: String,
    val favorite: Boolean = true,
    @SerialName("edited_at") val editedAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class RatingRow(
    @SerialName("track_id") val trackId: String,
    val rating: Int = 0,
    @SerialName("edited_at") val editedAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class PlaylistRow(
    val id: String,
    @SerialName("parent_id") val parentId: String? = null,
    val name: String = "",
    @SerialName("is_folder") val isFolder: Boolean = false,
    @SerialName("is_smart") val isSmart: Boolean = false,
    @SerialName("smart_rules") val smartRules: JsonElement? = null,
    val position: String = "a0",
    @SerialName("edited_at") val editedAt: String = "",
    @SerialName("deleted_at") val deletedAt: String? = null,
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class PlaylistItemRow(
    @SerialName("playlist_id") val playlistId: String,
    @SerialName("track_id") val trackId: String,
    val position: String = "a0",
    @SerialName("edited_at") val editedAt: String = "",
    @SerialName("deleted_at") val deletedAt: String? = null,
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class SettingRow(
    val scope: String,
    val key: String,
    val value: JsonElement,
    @SerialName("edited_at") val editedAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class QueueStateRow(
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("track_ids") val trackIds: List<String> = emptyList(),
    @SerialName("current_index") val currentIndex: Int = 0,
    @SerialName("position_seconds") val positionSeconds: Double = 0.0,
    val shuffle: Boolean = false,
    val repeat: String = "off",
    @SerialName("edited_at") val editedAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class PlayEventRow(
    val id: String,
    @SerialName("track_id") val trackId: String,
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("played_at") val playedAt: String = "",
    @SerialName("duration_played") val durationPlayed: Double = 0.0,
    val completed: Boolean = false,
    @SerialName("created_at") val createdAt: String = "",
)

// ---- Upsert/insert parameter shapes -------------------------------------------

data class TrackInsertMinimal(
    val contentHash: String,
    val fileName: String,
    val fileSize: Long,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Double,
)

data class PlaylistUpsert(
    val id: String,
    val parentId: String?,
    val name: String,
    val isFolder: Boolean,
    val isSmart: Boolean,
    val smartRules: JsonElement?,
    val position: String,
    val editedAt: String,
    val deletedAt: String?,
)

data class PlaylistItemUpsert(
    val playlistId: String,
    val trackId: String,
    val position: String,
    val editedAt: String,
    val deletedAt: String?,
)

data class QueueStateUpsert(
    val deviceId: String?,
    val trackIds: List<String>,
    val currentIndex: Int,
    val positionSeconds: Double,
    val shuffle: Boolean,
    val repeat: String,
    val editedAt: String,
)

data class PlayEventInsert(
    val id: String,
    val trackId: String,
    val deviceId: String?,
    val playedAt: String,
    val durationPlayed: Double,
    val completed: Boolean,
)
