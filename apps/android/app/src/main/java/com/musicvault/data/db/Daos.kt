package com.musicvault.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface PlaylistDao {
    // Alphabetical, matching sortPlaylists() on desktop and web.
    @Query("SELECT * FROM playlists ORDER BY name COLLATE NOCASE")
    fun observePlaylists(): Flow<List<PlaylistEntity>>

    @Query("SELECT * FROM playlist_tracks ORDER BY playlistId, position")
    fun observePlaylistTracks(): Flow<List<PlaylistTrackEntity>>

    @Query("SELECT * FROM playlists WHERE id = :id")
    suspend fun getPlaylist(id: String): PlaylistEntity?

    @Query("SELECT * FROM playlists ORDER BY createdAt")
    suspend fun getAllPlaylists(): List<PlaylistEntity>

    @Query("SELECT * FROM playlist_tracks ORDER BY playlistId, position")
    suspend fun tracksForAll(): List<PlaylistTrackEntity>

    @Query("SELECT * FROM playlist_tracks WHERE playlistId = :playlistId ORDER BY position")
    suspend fun tracksFor(playlistId: String): List<PlaylistTrackEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlaylist(playlist: PlaylistEntity)

    @Query("UPDATE playlists SET name = :name WHERE id = :id")
    suspend fun renamePlaylist(id: String, name: String)

    @Query("UPDATE playlists SET smartRules = :smartRules, isSmart = 1 WHERE id = :id")
    suspend fun setSmartRules(id: String, smartRules: String)

    @Query("DELETE FROM playlists WHERE id = :id")
    suspend fun deletePlaylist(id: String)

    @Query("DELETE FROM playlist_tracks WHERE playlistId = :playlistId")
    suspend fun deletePlaylistTracks(playlistId: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertPlaylistTrack(entry: PlaylistTrackEntity)

    @Query("DELETE FROM playlist_tracks WHERE playlistId = :playlistId AND trackId = :trackId")
    suspend fun removePlaylistTrack(playlistId: String, trackId: String)

    @Query("SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlistId = :playlistId")
    suspend fun nextPosition(playlistId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlaylistTracks(entries: List<PlaylistTrackEntity>)

    @Transaction
    suspend fun replacePlaylistTracks(playlistId: String, trackIds: List<String>) {
        deletePlaylistTracks(playlistId)
        insertPlaylistTracks(trackIds.mapIndexed { index, trackId ->
            PlaylistTrackEntity(playlistId = playlistId, trackId = trackId, position = index)
        })
    }

    @Query("DELETE FROM playlist_tracks WHERE trackId = :trackId")
    suspend fun removeTrackFromAllPlaylists(trackId: String)
}

@Dao
interface HistoryDao {
    @Query("SELECT * FROM play_history")
    fun observeAll(): Flow<List<PlayHistoryEntity>>

    // Update-then-insert instead of ON CONFLICT DO UPDATE, which needs SQLite 3.24+
    // (not available on Android 9 / API 28 devices).
    @Query("UPDATE play_history SET playCount = playCount + 1, lastPlayedAt = :playedAt WHERE trackId = :trackId")
    suspend fun incrementPlay(trackId: String, playedAt: Long): Int

    @Query("UPDATE play_history SET listenSeconds = listenSeconds + :seconds WHERE trackId = :trackId")
    suspend fun incrementListenSeconds(trackId: String, seconds: Long): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: PlayHistoryEntity): Long

    @Transaction
    suspend fun recordPlay(trackId: String, playedAt: Long) {
        if (incrementPlay(trackId, playedAt) == 0) {
            insert(PlayHistoryEntity(trackId = trackId, playCount = 1, listenSeconds = 0, lastPlayedAt = playedAt))
        }
    }

    @Transaction
    suspend fun addListenSeconds(trackId: String, seconds: Long) {
        if (incrementListenSeconds(trackId, seconds) == 0) {
            insert(PlayHistoryEntity(trackId = trackId, playCount = 0, listenSeconds = seconds, lastPlayedAt = null))
        }
    }

    /** Clears the recently-played order but keeps play counts (web historyStore.clear). */
    @Query("UPDATE play_history SET lastPlayedAt = NULL")
    suspend fun clearRecents()

    @Query("DELETE FROM play_history WHERE trackId = :trackId")
    suspend fun delete(trackId: String)
}

@Dao
interface DownloadDao {
    @Query("SELECT * FROM downloads ORDER BY downloadedAt DESC")
    fun observeAll(): Flow<List<DownloadEntity>>

    @Query("SELECT * FROM downloads WHERE fileId = :fileId")
    suspend fun get(fileId: String): DownloadEntity?

    @Query("SELECT fileId FROM downloads")
    fun observeFileIds(): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(download: DownloadEntity)

    @Query("DELETE FROM downloads WHERE fileId = :fileId")
    suspend fun delete(fileId: String)
}

/** Phase 7: the local play-event log — append-only, idempotent on id. */
@Dao
interface PlayEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun add(event: PlayEventEntity)

    @Query("SELECT * FROM play_events ORDER BY playedAt")
    fun observeAll(): Flow<List<PlayEventEntity>>
}

@Dao
interface SyncDao {
    @Query("SELECT * FROM sync_outbox ORDER BY createdAt, id")
    suspend fun outboxAll(): List<SyncOutboxEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun outboxPut(entry: SyncOutboxEntity)

    @Query("SELECT attempts FROM sync_outbox WHERE id = :id")
    suspend fun outboxAttempts(id: String): Int?

    @Query("DELETE FROM sync_outbox WHERE id IN (:ids)")
    suspend fun outboxDelete(ids: List<String>)

    @Query("UPDATE sync_outbox SET attempts = attempts + 1 WHERE id IN (:ids)")
    suspend fun outboxBumpAttempts(ids: List<String>)

    @Query("SELECT value FROM sync_cursors WHERE name = :name")
    suspend fun cursorGet(name: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun cursorSet(entity: SyncCursorEntity)

    @Query("SELECT payload FROM sync_shadow WHERE entity = :entity AND id = :id")
    suspend fun shadowGet(entity: String, id: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun shadowPut(row: SyncShadowEntity)

    @Query("DELETE FROM sync_shadow WHERE entity = :entity AND id = :id")
    suspend fun shadowDelete(entity: String, id: String)

    @Query("SELECT * FROM sync_shadow WHERE entity = :entity")
    suspend fun shadowAll(entity: String): List<SyncShadowEntity>

    /** Reactive shadow reads — statistics re-aggregate as pulls land. */
    @Query("SELECT * FROM sync_shadow WHERE entity = :entity")
    fun observeShadow(entity: String): Flow<List<SyncShadowEntity>>

    @Query("DELETE FROM sync_outbox")
    suspend fun clearOutbox()

    @Query("DELETE FROM sync_cursors")
    suspend fun clearCursors()

    @Query("DELETE FROM sync_shadow")
    suspend fun clearShadow()

    @Transaction
    suspend fun clearAll() {
        clearOutbox()
        clearCursors()
        clearShadow()
    }
}

@Dao
interface QueueDao {
    @Query("SELECT * FROM queue_items ORDER BY position")
    suspend fun getQueue(): List<QueueItemEntity>

    @Query("DELETE FROM queue_items")
    suspend fun clear()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<QueueItemEntity>)

    @Transaction
    suspend fun replaceQueue(trackIds: List<String>) {
        clear()
        insertAll(trackIds.mapIndexed { index, id -> QueueItemEntity(position = index, trackId = id) })
    }
}

