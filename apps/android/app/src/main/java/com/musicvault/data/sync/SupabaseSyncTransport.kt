package com.musicvault.data.sync

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.exceptions.HttpRequestException
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import timber.log.Timber
import java.io.IOException

/**
 * Production [SyncTransport] over supabase-kt — the Kotlin counterpart of
 * packages/core/src/sync/transport.ts SupabaseTransport. RLS scopes every
 * query to the signed-in user; writes carry user_id explicitly.
 */
class SupabaseSyncTransport(
    private val client: SupabaseClient,
    private val userId: String,
    private val scope: CoroutineScope,
) : SyncTransport {

    /** Maps connectivity failures to [SyncNetworkException] (flush stops, ops stay queued). */
    private suspend fun <T> guarded(block: suspend () -> T): T = try {
        block()
    } catch (e: HttpRequestException) {
        throw SyncNetworkException(e.message ?: "network error", e)
    } catch (e: IOException) {
        throw SyncNetworkException(e.message ?: "network error", e)
    }

    /**
     * Every row changed after [since], oldest first. Paged: PostgREST caps one
     * response (1,000 rows on Supabase), and a full pull must see every row —
     * the engine prunes the tracks shadow to exactly what it returns. [tiebreak]
     * (the primary key) keeps the order stable across pages when timestamps tie.
     */
    private suspend inline fun <reified T : Any> pull(
        table: String,
        cursorColumn: String,
        tiebreak: List<String>,
        since: String?,
    ): List<T> = guarded {
        val out = mutableListOf<T>()
        var from = 0L
        while (true) {
            val page = client.from(table).select {
                if (since != null) filter { gt(cursorColumn, since) }
                order(cursorColumn, Order.ASCENDING)
                for (column in tiebreak) order(column, Order.ASCENDING)
                range(from, from + PULL_PAGE - 1)
            }.decodeList<T>()
            out += page
            if (page.size < PULL_PAGE.toInt()) break
            from += PULL_PAGE
        }
        out
    }

    override suspend fun pullTracks(since: String?): List<TrackRow> = pull("tracks", "updated_at", listOf("id"), since)
    override suspend fun pullPlaylists(since: String?): List<PlaylistRow> =
        pull("playlists", "updated_at", listOf("id"), since)
    override suspend fun pullPlaylistItems(since: String?): List<PlaylistItemRow> =
        pull("playlist_items", "updated_at", listOf("id"), since)
    override suspend fun pullFavorites(since: String?): List<FavoriteRow> =
        pull("favorites", "updated_at", listOf("track_id"), since)
    override suspend fun pullRatings(since: String?): List<RatingRow> =
        pull("ratings", "updated_at", listOf("track_id"), since)
    override suspend fun pullSettings(since: String?): List<SettingRow> =
        pull("settings", "updated_at", listOf("scope", "key"), since)
    override suspend fun pullPlayEvents(since: String?): List<PlayEventRow> =
        pull("play_events", "created_at", listOf("id"), since)

    override suspend fun pullQueueState(): QueueStateRow? = guarded {
        client.from("queue_state").select().decodeSingleOrNull<QueueStateRow>()
    }

    override suspend fun getTrackByHash(contentHash: String): TrackRow? = guarded {
        client.from("tracks").select {
            filter { eq("content_hash", contentHash) }
            limit(1)
        }.decodeSingleOrNull<TrackRow>()
    }

    override suspend fun insertTrack(row: TrackInsertMinimal): TrackRow = guarded {
        // Upsert on the content-hash index so two devices racing to create the
        // same track converge on one row.
        val conflict = "user_id,content_hash"
        client.from("tracks").upsert(
            TrackInsertRow(
                userId = userId,
                contentHash = row.contentHash,
                fileName = row.fileName,
                fileSize = row.fileSize,
                title = row.title,
                artist = row.artist,
                album = row.album,
                duration = row.duration,
            ),
        ) {
            onConflict = conflict
            select()
        }.decodeSingle<TrackRow>()
    }

    override suspend fun applyTrackEdit(trackId: String, patch: JsonObject, editedAt: String): TrackRow? = guarded {
        try {
            client.postgrest.rpc(
                "apply_track_edit",
                buildJsonObject {
                    put("p_track_id", trackId)
                    put("p_patch", patch)
                    put("p_edited_at", editedAt)
                },
            ).decodeAs<TrackRow>()
        } catch (e: RestException) {
            // supabase-kt 3.0 drops the SQLSTATE (P0002), so match apply_track_edit's
            // message instead: the track was deleted or isn't ours — nothing to edit.
            if (e.error == "track not found") null else throw e
        }
    }

    override suspend fun getFavorite(trackId: String): FavoriteRow? = guarded {
        client.from("favorites").select {
            filter { eq("track_id", trackId) }
            limit(1)
        }.decodeSingleOrNull<FavoriteRow>()
    }

    override suspend fun upsertFavorite(trackId: String, favorite: Boolean, editedAt: String) {
        guarded {
            client.from("favorites").upsert(
                FavoriteUpsertRow(userId = userId, trackId = trackId, favorite = favorite, editedAt = editedAt),
            ) { onConflict = "user_id,track_id" }
        }
    }

    override suspend fun getRating(trackId: String): RatingRow? = guarded {
        client.from("ratings").select {
            filter { eq("track_id", trackId) }
            limit(1)
        }.decodeSingleOrNull<RatingRow>()
    }

    override suspend fun upsertRating(trackId: String, rating: Int, editedAt: String) {
        guarded {
            client.from("ratings").upsert(
                RatingUpsertRow(userId = userId, trackId = trackId, rating = rating, editedAt = editedAt),
            ) { onConflict = "user_id,track_id" }
        }
    }

    override suspend fun getPlaylist(id: String): PlaylistRow? = guarded {
        client.from("playlists").select {
            filter { eq("id", id) }
            limit(1)
        }.decodeSingleOrNull<PlaylistRow>()
    }

    override suspend fun upsertPlaylist(row: PlaylistUpsert) {
        guarded {
            client.from("playlists").upsert(
                PlaylistUpsertRow(
                    userId = userId,
                    id = row.id,
                    parentId = row.parentId,
                    name = row.name,
                    isFolder = row.isFolder,
                    isSmart = row.isSmart,
                    smartRules = row.smartRules,
                    position = row.position,
                    editedAt = row.editedAt,
                    deletedAt = row.deletedAt,
                ),
            )
        }
    }

    override suspend fun getPlaylistItems(playlistId: String): List<PlaylistItemRow> = guarded {
        client.from("playlist_items").select {
            filter { eq("playlist_id", playlistId) }
        }.decodeList<PlaylistItemRow>()
    }

    override suspend fun upsertPlaylistItem(row: PlaylistItemUpsert) {
        guarded {
            client.from("playlist_items").upsert(
                PlaylistItemUpsertRow(
                    userId = userId,
                    playlistId = row.playlistId,
                    trackId = row.trackId,
                    position = row.position,
                    editedAt = row.editedAt,
                    deletedAt = row.deletedAt,
                ),
            ) { onConflict = "playlist_id,track_id" }
        }
    }

    override suspend fun getSetting(scope: String, key: String): SettingRow? = guarded {
        client.from("settings").select {
            filter {
                eq("scope", scope)
                eq("key", key)
            }
            limit(1)
        }.decodeSingleOrNull<SettingRow>()
    }

    override suspend fun upsertSetting(scope: String, key: String, value: JsonElement, editedAt: String) {
        guarded {
            client.from("settings").upsert(
                SettingUpsertRow(userId = userId, scope = scope, key = key, value = value, editedAt = editedAt),
            ) { onConflict = "user_id,scope,key" }
        }
    }

    override suspend fun upsertQueueState(row: QueueStateUpsert) {
        guarded {
            client.from("queue_state").upsert(
                QueueStateUpsertRow(
                    userId = userId,
                    deviceId = row.deviceId,
                    trackIds = row.trackIds,
                    currentIndex = row.currentIndex,
                    positionSeconds = row.positionSeconds,
                    shuffle = row.shuffle,
                    repeat = row.repeat,
                    editedAt = row.editedAt,
                ),
            )
        }
    }

    override suspend fun insertPlayEvent(row: PlayEventInsert) {
        guarded {
            client.from("play_events").upsert(
                PlayEventInsertRow(
                    id = row.id,
                    userId = userId,
                    trackId = row.trackId,
                    deviceId = row.deviceId,
                    playedAt = row.playedAt,
                    durationPlayed = row.durationPlayed,
                    completed = row.completed,
                ),
            ) {
                onConflict = "id"
                ignoreDuplicates = true
            }
        }
    }

    override fun subscribe(onChange: () -> Unit): () -> Unit {
        val channel = client.channel("sync-$userId")
        val subScope = scope + SupervisorJob(scope.coroutineContext[Job])
        for (table in SYNCED_TABLES) {
            val flow = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                this.table = table
                filter("user_id", FilterOperator.EQ, userId)
            }
            subScope.launch { flow.collect { onChange() } }
        }
        subScope.launch {
            try {
                channel.subscribe()
            } catch (e: Exception) {
                // Realtime is only a "pull sooner" hint — cursor pulls stay correct.
                Timber.w(e, "realtime subscribe failed")
            }
        }
        return {
            subScope.cancel()
            scope.launch {
                try {
                    client.realtime.removeChannel(channel)
                } catch (e: Exception) {
                    Timber.w(e, "realtime unsubscribe failed")
                }
            }
        }
    }

    private companion object {
        /** Rows per pull request — Supabase's default PostgREST response cap. */
        const val PULL_PAGE = 1000L

        val SYNCED_TABLES = listOf(
            "tracks", "playlists", "playlist_items", "favorites",
            "ratings", "settings", "queue_state", "play_events",
        )
    }
}

// ---- write payloads (user_id carried explicitly; RLS checks it) ---------------

@Serializable
private data class TrackInsertRow(
    @SerialName("user_id") val userId: String,
    @SerialName("content_hash") val contentHash: String,
    @SerialName("file_name") val fileName: String,
    @SerialName("file_size") val fileSize: Long,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Double,
)

@Serializable
private data class FavoriteUpsertRow(
    @SerialName("user_id") val userId: String,
    @SerialName("track_id") val trackId: String,
    val favorite: Boolean,
    @SerialName("edited_at") val editedAt: String,
)

@Serializable
private data class RatingUpsertRow(
    @SerialName("user_id") val userId: String,
    @SerialName("track_id") val trackId: String,
    val rating: Int,
    @SerialName("edited_at") val editedAt: String,
)

@Serializable
private data class PlaylistUpsertRow(
    @SerialName("user_id") val userId: String,
    val id: String,
    @SerialName("parent_id") val parentId: String?,
    val name: String,
    @SerialName("is_folder") val isFolder: Boolean,
    @SerialName("is_smart") val isSmart: Boolean,
    @SerialName("smart_rules") val smartRules: JsonElement?,
    val position: String,
    @SerialName("edited_at") val editedAt: String,
    @SerialName("deleted_at") val deletedAt: String?,
)

@Serializable
private data class PlaylistItemUpsertRow(
    @SerialName("user_id") val userId: String,
    @SerialName("playlist_id") val playlistId: String,
    @SerialName("track_id") val trackId: String,
    val position: String,
    @SerialName("edited_at") val editedAt: String,
    @SerialName("deleted_at") val deletedAt: String?,
)

@Serializable
private data class SettingUpsertRow(
    @SerialName("user_id") val userId: String,
    val scope: String,
    val key: String,
    val value: JsonElement,
    @SerialName("edited_at") val editedAt: String,
)

@Serializable
private data class QueueStateUpsertRow(
    @SerialName("user_id") val userId: String,
    @SerialName("device_id") val deviceId: String?,
    @SerialName("track_ids") val trackIds: List<String>,
    @SerialName("current_index") val currentIndex: Int,
    @SerialName("position_seconds") val positionSeconds: Double,
    val shuffle: Boolean,
    val repeat: String,
    @SerialName("edited_at") val editedAt: String,
)

@Serializable
private data class PlayEventInsertRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("track_id") val trackId: String,
    @SerialName("device_id") val deviceId: String?,
    @SerialName("played_at") val playedAt: String,
    @SerialName("duration_played") val durationPlayed: Double,
    val completed: Boolean,
)
