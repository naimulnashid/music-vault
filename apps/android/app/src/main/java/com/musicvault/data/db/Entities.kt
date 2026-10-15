package com.musicvault.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "playlists")
data class PlaylistEntity(
    @PrimaryKey val id: String,
    val name: String,
    val createdAt: Long,
    @ColumnInfo(defaultValue = "0") val isSmart: Boolean = false,
    /** JSON-serialized SmartRules (same schema as @musicvault/core smartRules.ts). */
    val smartRules: String? = null,
)

@Entity(
    tableName = "playlist_tracks",
    primaryKeys = ["playlistId", "trackId"],
    indices = [Index("playlistId")],
)
data class PlaylistTrackEntity(
    val playlistId: String,
    val trackId: String,
    val position: Int,
)

/**
 * Play history per track: playCount / listenSeconds drive Most Played, Never Played
 * and Statistics; lastPlayedAt (nullable) orders Recently Played. Clearing recents
 * nulls lastPlayedAt but keeps counts — same behavior as the web historyStore.
 */
@Entity(tableName = "play_history")
data class PlayHistoryEntity(
    @PrimaryKey val trackId: String,
    @ColumnInfo(defaultValue = "0") val playCount: Int,
    @ColumnInfo(defaultValue = "0") val listenSeconds: Long,
    val lastPlayedAt: Long?,
)

/** Persisted playback queue so it survives app restarts. */
@Entity(tableName = "queue_items")
data class QueueItemEntity(
    @PrimaryKey val position: Int,
    val trackId: String,
)

/**
 * Phase 7: the local play-event log — one row per listening session, the
 * statistics source. Device-owned history: deliberately NOT wiped on
 * sign-out, unlike the sync_* tables. trackId is the library id
 * (`vault:<hash>`); id is shared with the playEvent.add sync op so the
 * copy pulled back into the shadow dedupes against this row.
 */
@Entity(tableName = "play_events", indices = [Index("playedAt")])
data class PlayEventEntity(
    @PrimaryKey val id: String,
    val trackId: String,
    /** Session start, epoch ms. */
    val playedAt: Long,
    /** Seconds actually listened. */
    val durationPlayed: Double,
    val completed: Boolean,
)

// ---- Sync engine persistence (Phase 6; see docs/sync-protocol.md) -------------
// Mirrors desktop's sync_outbox / sync_cursors / sync_shadow SQLite tables:
// the outbox survives crashes (the "no data loss" invariant), the shadow is a
// local mirror of remote rows keyed (entity, id) with the raw row JSON.

@Entity(tableName = "sync_outbox")
data class SyncOutboxEntity(
    /** Client-generated op id — the idempotency key. */
    @PrimaryKey val id: String,
    val createdAt: String,
    /** Full SyncOp envelope JSON (deviceId + payload). */
    val payload: String,
    @ColumnInfo(defaultValue = "0") val attempts: Int = 0,
)

@Entity(tableName = "sync_cursors")
data class SyncCursorEntity(
    @PrimaryKey val name: String,
    val value: String,
)

@Entity(tableName = "sync_shadow", primaryKeys = ["entity", "id"])
data class SyncShadowEntity(
    val entity: String,
    val id: String,
    val payload: String,
)

/**
 * Pinned downloads — tier 2 of the two-tier cache model (permanent until the
 * user removes them). Tier 1 (auto-cache) is Media3's SimpleCache with LRU
 * eviction and needs no Room bookkeeping.
 */
@Entity(tableName = "downloads")
data class DownloadEntity(
    @PrimaryKey val fileId: String,
    val fileName: String,
    val title: String,
    val artist: String,
    val sizeBytes: Long,
    val path: String,
    val downloadedAt: Long,
)
