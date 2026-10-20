package com.musicvault.data.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Kotlin port of packages/core/src/sync/types.ts — the outbox op envelope and
 * the remote-change batches surfaced to the app. docs/sync-protocol.md is the
 * normative spec; op kinds and JSON field names match the TS engine exactly.
 */

/** JSON codec for sync payloads: "kind"-discriminated ops, lenient row decode. */
val SyncJson: Json = Json {
    classDiscriminator = "kind"
    ignoreUnknownKeys = true
    encodeDefaults = false
}

/**
 * A reference to a track that may or may not exist in the remote `tracks`
 * table yet. Ops carry every identity the client knows plus enough metadata
 * to create a minimal canonical row at flush time. A ref with neither
 * [remoteId] nor [contentHash] is unsyncable (the remote schema requires a
 * hash identity) and must not be enqueued.
 */
@Serializable
data class TrackRef(
    val remoteId: String? = null,
    val contentHash: String? = null,
    val fileName: String? = null,
    val fileSize: Long? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val duration: Double? = null,
) {
    fun hasIdentity(): Boolean = remoteId != null || contentHash != null

    /**
     * Stable key for "the same track" across ops, used for outbox coalescing
     * and pending-op conflict checks. Prefers durable identities over the
     * remote id so an op enqueued before the remote row existed still matches
     * one after.
     */
    fun key(): String = when {
        contentHash != null -> "hash:$contentHash"
        else -> "remote:${remoteId ?: ""}"
    }

    /**
     * Every key under which this ref can be known — pending-op lookups match
     * on any of them, so an op that only knew a content hash still matches the
     * remote row it now has an id for.
     */
    fun keys(): List<String> = buildList {
        if (contentHash != null) add("hash:$contentHash")
        if (remoteId != null) add("remote:$remoteId")
    }
}

@Serializable
data class PlaylistSnapshot(
    val id: String,
    val parentId: String? = null,
    val name: String,
    val isFolder: Boolean = false,
    val isSmart: Boolean = false,
    /** JSON SmartRules AST, or null. */
    val smartRules: JsonElement? = null,
    val position: String = "a0",
)

@Serializable
sealed interface SyncOpPayload {

    @Serializable
    @SerialName("favorite.set")
    data class FavoriteSet(val track: TrackRef, val favorite: Boolean, val editedAt: String) : SyncOpPayload

    @Serializable
    @SerialName("rating.set")
    data class RatingSet(val track: TrackRef, val rating: Int, val editedAt: String) : SyncOpPayload

    @Serializable
    @SerialName("playlist.upsert")
    data class PlaylistUpsertOp(val playlist: PlaylistSnapshot, val editedAt: String) : SyncOpPayload

    @Serializable
    @SerialName("playlist.delete")
    data class PlaylistDelete(val playlistId: String, val editedAt: String) : SyncOpPayload

    @Serializable
    @SerialName("playlistItem.add")
    data class PlaylistItemAdd(
        val playlistId: String,
        val track: TrackRef,
        /** Order anchors captured at enqueue time; absent anchors mean append. */
        val prevTrack: TrackRef? = null,
        val nextTrack: TrackRef? = null,
        val editedAt: String,
    ) : SyncOpPayload

    @Serializable
    @SerialName("playlistItem.remove")
    data class PlaylistItemRemove(val playlistId: String, val track: TrackRef, val editedAt: String) : SyncOpPayload

    @Serializable
    @SerialName("playlist.reorder")
    data class PlaylistReorder(
        val playlistId: String,
        /** Full desired order. */
        val tracks: List<TrackRef>,
        val editedAt: String,
    ) : SyncOpPayload

    @Serializable
    @SerialName("setting.set")
    data class SettingSet(
        /** "global" or a device id. */
        val scope: String,
        val key: String,
        val value: JsonElement,
        val editedAt: String,
    ) : SyncOpPayload

    @Serializable
    @SerialName("queue.set")
    data class QueueSet(
        val tracks: List<TrackRef>,
        val currentIndex: Int,
        val positionSeconds: Double,
        val shuffle: Boolean,
        /** "off" | "one" | "all" — same strings as the TS RepeatMode. */
        val repeat: String,
        val editedAt: String,
    ) : SyncOpPayload

    /**
     * Field-level LWW metadata edit (flushes through apply_track_edit). Only
     * the fields present in [patch] (Supabase column names) are written, each
     * only if this edit is at least as new as that field's last edit.
     */
    @Serializable
    @SerialName("track.edit")
    data class TrackEditOp(val track: TrackRef, val patch: JsonObject, val editedAt: String) : SyncOpPayload

    @Serializable
    @SerialName("playEvent.add")
    data class PlayEventAdd(
        val eventId: String,
        val track: TrackRef,
        val playedAt: String,
        val durationPlayed: Double,
        val completed: Boolean,
    ) : SyncOpPayload
}

/**
 * Coalescing/conflict identity: ops with the same entity key target the same
 * LWW row, so only the newest needs to be flushed. Play events return a
 * per-op key — they are append-only and never coalesce.
 */
fun SyncOpPayload.entityKey(): String = when (this) {
    is SyncOpPayload.FavoriteSet -> "favorite/${track.key()}"
    is SyncOpPayload.RatingSet -> "rating/${track.key()}"
    is SyncOpPayload.PlaylistUpsertOp -> "playlist/${playlist.id}"
    is SyncOpPayload.PlaylistDelete -> "playlist/$playlistId"
    is SyncOpPayload.PlaylistItemAdd -> "playlistItem/$playlistId/${track.key()}"
    is SyncOpPayload.PlaylistItemRemove -> "playlistItem/$playlistId/${track.key()}"
    is SyncOpPayload.PlaylistReorder -> "playlistReorder/$playlistId"
    is SyncOpPayload.SettingSet -> "setting/$scope/$key"
    is SyncOpPayload.QueueSet -> "queue"
    // Edits only supersede each other when they touch the same fields.
    is SyncOpPayload.TrackEditOp -> "trackEdit/${track.key()}/${patch.keys.sorted().joinToString(",")}"
    is SyncOpPayload.PlayEventAdd -> "playEvent/$eventId"
}

/** The wire discriminator of an op (matches the TS payload `kind`). */
fun SyncOpPayload.kind(): String = when (this) {
    is SyncOpPayload.FavoriteSet -> "favorite.set"
    is SyncOpPayload.RatingSet -> "rating.set"
    is SyncOpPayload.PlaylistUpsertOp -> "playlist.upsert"
    is SyncOpPayload.PlaylistDelete -> "playlist.delete"
    is SyncOpPayload.PlaylistItemAdd -> "playlistItem.add"
    is SyncOpPayload.PlaylistItemRemove -> "playlistItem.remove"
    is SyncOpPayload.PlaylistReorder -> "playlist.reorder"
    is SyncOpPayload.SettingSet -> "setting.set"
    is SyncOpPayload.QueueSet -> "queue.set"
    is SyncOpPayload.TrackEditOp -> "track.edit"
    is SyncOpPayload.PlayEventAdd -> "playEvent.add"
}

/** The LWW timestamp of an op (play events use their playedAt). */
fun SyncOpPayload.editedAt(): String = when (this) {
    is SyncOpPayload.FavoriteSet -> editedAt
    is SyncOpPayload.RatingSet -> editedAt
    is SyncOpPayload.PlaylistUpsertOp -> editedAt
    is SyncOpPayload.PlaylistDelete -> editedAt
    is SyncOpPayload.PlaylistItemAdd -> editedAt
    is SyncOpPayload.PlaylistItemRemove -> editedAt
    is SyncOpPayload.PlaylistReorder -> editedAt
    is SyncOpPayload.SettingSet -> editedAt
    is SyncOpPayload.QueueSet -> editedAt
    is SyncOpPayload.TrackEditOp -> editedAt
    is SyncOpPayload.PlayEventAdd -> playedAt
}

/** The persisted outbox envelope. [id] is the idempotency key. */
@Serializable
data class SyncOp(
    val id: String,
    val deviceId: String? = null,
    val createdAt: String,
    val payload: SyncOpPayload,
)

// ---- Remote state as surfaced to the app after a pull -----------------------

/** The identities of a remote track row, for mapping to client-local tracks. */
data class TrackIdentity(
    val remoteId: String,
    val contentHash: String?,
)

data class FavoriteChange(val track: TrackIdentity, val favorite: Boolean, val editedAt: String)

data class RatingChange(val track: TrackIdentity, val rating: Int, val editedAt: String)

data class PlaylistChange(
    val id: String,
    val parentId: String?,
    val name: String,
    val isFolder: Boolean,
    val isSmart: Boolean,
    val smartRules: JsonElement?,
    val position: String,
    val deleted: Boolean,
    val editedAt: String,
)

data class PlaylistItemsChange(
    val playlistId: String,
    /** Live items in list order (deleted items excluded). */
    val tracks: List<TrackIdentity>,
)

data class SettingChange(val scope: String, val key: String, val value: JsonElement, val editedAt: String)

data class QueueChange(
    val tracks: List<TrackIdentity>,
    val currentIndex: Int,
    val positionSeconds: Double,
    val shuffle: Boolean,
    val repeat: String,
    val deviceId: String?,
    val editedAt: String,
)

/** Everything a sync cycle applied, batched for the app to project into its stores. */
class RemoteChanges {
    var tracksChanged: Boolean = false
    val favorites = mutableListOf<FavoriteChange>()
    val ratings = mutableListOf<RatingChange>()
    val playlists = mutableListOf<PlaylistChange>()
    val playlistItems = mutableListOf<PlaylistItemsChange>()
    val settings = mutableListOf<SettingChange>()
    var queue: QueueChange? = null
    var playEventsAdded: Int = 0

    fun hasAny(): Boolean =
        tracksChanged || favorites.isNotEmpty() || ratings.isNotEmpty() || playlists.isNotEmpty() ||
            playlistItems.isNotEmpty() || settings.isNotEmpty() || queue != null || playEventsAdded > 0
}

/**
 * AUTH is Android-only for now: the session was rejected and a refresh failed,
 * so the engine is paused until the user signs in again.
 */
enum class SyncPhase { IDLE, SYNCING, OFFLINE, ERROR, AUTH }

data class SyncStatus(
    val phase: SyncPhase = SyncPhase.IDLE,
    val pendingOps: Int = 0,
    val lastSyncAt: String? = null,
    val lastError: String? = null,
)

/**
 * A diagnostic trail entry (mirrors SyncBreadcrumb in core types.ts).
 * Breadcrumbs are observability only — they carry no sync semantics.
 */
data class SyncBreadcrumb(
    val at: String,
    val event: String,
    val detail: Map<String, Any?> = emptyMap(),
)
