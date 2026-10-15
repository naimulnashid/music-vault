package com.musicvault.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        PlaylistEntity::class,
        PlaylistTrackEntity::class,
        PlayHistoryEntity::class,
        QueueItemEntity::class,
        SyncOutboxEntity::class,
        SyncCursorEntity::class,
        SyncShadowEntity::class,
        DownloadEntity::class,
        PlayEventEntity::class,
    ],
    version = 7,
    exportSchema = false,
)
abstract class MusicVaultDatabase : RoomDatabase() {
    abstract fun playlistDao(): PlaylistDao
    abstract fun historyDao(): HistoryDao
    abstract fun playEventDao(): PlayEventDao
    abstract fun queueDao(): QueueDao
    abstract fun syncDao(): SyncDao
    abstract fun downloadDao(): DownloadDao

    companion object {
        /** Phase 2: richer metadata, ratings, content hashing, rule-based smart playlists. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tracks ADD COLUMN albumArtist TEXT")
                db.execSQL("ALTER TABLE tracks ADD COLUMN composer TEXT")
                db.execSQL("ALTER TABLE tracks ADD COLUMN trackNo INTEGER")
                db.execSQL("ALTER TABLE tracks ADD COLUMN discNo INTEGER")
                db.execSQL("ALTER TABLE tracks ADD COLUMN bpm REAL")
                db.execSQL("ALTER TABLE tracks ADD COLUMN rgTrackGain REAL")
                db.execSQL("ALTER TABLE tracks ADD COLUMN rgAlbumGain REAL")
                db.execSQL("ALTER TABLE tracks ADD COLUMN rating INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE tracks ADD COLUMN contentHash TEXT")
                db.execSQL("ALTER TABLE playlists ADD COLUMN isSmart INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE playlists ADD COLUMN smartRules TEXT")
            }
        }

        /** Phase 6: sync engine persistence (outbox/cursors/shadow) + Drive identity. */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tracks ADD COLUMN driveFileId TEXT")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS sync_outbox (" +
                        "id TEXT NOT NULL PRIMARY KEY, " +
                        "createdAt TEXT NOT NULL, " +
                        "payload TEXT NOT NULL, " +
                        "attempts INTEGER NOT NULL DEFAULT 0)"
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS sync_cursors (" +
                        "name TEXT NOT NULL PRIMARY KEY, " +
                        "value TEXT NOT NULL)"
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS sync_shadow (" +
                        "entity TEXT NOT NULL, " +
                        "id TEXT NOT NULL, " +
                        "payload TEXT NOT NULL, " +
                        "PRIMARY KEY(entity, id))"
                )
            }
        }

        /** Phase 6: Google Drive file index. */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS drive_files (" +
                        "fileId TEXT NOT NULL PRIMARY KEY, " +
                        "name TEXT NOT NULL, " +
                        "size INTEGER NOT NULL, " +
                        "md5 TEXT, " +
                        "mimeType TEXT, " +
                        "folderPath TEXT, " +
                        "modifiedAt INTEGER)"
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS drive_folders (" +
                        "id TEXT NOT NULL PRIMARY KEY, " +
                        "name TEXT NOT NULL, " +
                        "parentId TEXT, " +
                        "path TEXT NOT NULL)"
                )
            }
        }

        /** Phase 6: pinned downloads bookkeeping (two-tier cache, tier 2). */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS downloads (" +
                        "fileId TEXT NOT NULL PRIMARY KEY, " +
                        "fileName TEXT NOT NULL, " +
                        "title TEXT NOT NULL, " +
                        "artist TEXT NOT NULL, " +
                        "sizeBytes INTEGER NOT NULL, " +
                        "path TEXT NOT NULL, " +
                        "downloadedAt INTEGER NOT NULL)"
                )
            }
        }

        /** Phase 7: local play-event log (statistics source). */
        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS play_events (" +
                        "id TEXT NOT NULL PRIMARY KEY, " +
                        "trackId TEXT NOT NULL, " +
                        "playedAt INTEGER NOT NULL, " +
                        "durationPlayed REAL NOT NULL, " +
                        "completed INTEGER NOT NULL)"
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_play_events_playedAt ON play_events(playedAt)"
                )
            }
        }

        /**
         * Google Drive and local folders are retired and the library was rebuilt
         * from scratch online (docs/drive-to-r2-migration.md, decision 8): drop
         * their tables and clear everything that described the old library, so
         * nothing stale syncs back. The files (pinned downloads, cache, art) are
         * cleared at app start by FreshStart.
         */
        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                for (table in listOf("tracks", "drive_files", "drive_folders")) {
                    db.execSQL("DROP TABLE IF EXISTS $table")
                }
                for (table in listOf(
                    "playlists", "playlist_tracks", "play_history", "queue_items", "play_events",
                    "downloads", "sync_outbox", "sync_cursors", "sync_shadow",
                )) {
                    db.execSQL("DELETE FROM $table")
                }
            }
        }
    }
}
