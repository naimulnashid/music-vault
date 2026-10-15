pub mod models;
pub mod queries;

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::AppResult;

/// Shared handle to the library database. rusqlite connections are not Sync,
/// so access is serialized through a mutex — fine for a single-user app.
#[derive(Clone)]
pub struct Db(pub Arc<Mutex<Connection>>);

const SCHEMA_VERSION: i64 = 9;

pub fn open(db_path: &Path) -> AppResult<Db> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    tracing::info!(path = %db_path.display(), "database opened");
    Ok(Db(Arc::new(Mutex::new(conn))))
}

fn migrate(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    if version < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tracks (
              id          TEXT PRIMARY KEY,
              file_name   TEXT NOT NULL,
              file_size   INTEGER NOT NULL,
              mtime       INTEGER NOT NULL,
              title       TEXT NOT NULL,
              artist      TEXT NOT NULL DEFAULT 'Unknown Artist',
              album       TEXT NOT NULL DEFAULT 'Unknown Album',
              genre       TEXT,
              year        INTEGER,
              language    TEXT,
              duration    REAL NOT NULL DEFAULT 0,
              sample_rate INTEGER,
              bit_depth   INTEGER,
              channels    INTEGER,
              codec       TEXT,
              artwork     TEXT,
              lyrics_text TEXT,
              lyrics_lrc  TEXT,
              added_at    INTEGER NOT NULL,
              favorite    INTEGER NOT NULL DEFAULT 0,
              missing     INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_tracks_album  ON tracks(album);
            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);

            CREATE TABLE IF NOT EXISTS playlists (
              id         TEXT PRIMARY KEY,
              name       TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlist_tracks (
              playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
              track_id    TEXT NOT NULL REFERENCES tracks(id)   ON DELETE CASCADE,
              position    INTEGER NOT NULL,
              PRIMARY KEY (playlist_id, track_id)
            );
            CREATE INDEX IF NOT EXISTS idx_pt_order ON playlist_tracks(playlist_id, position);

            CREATE TABLE IF NOT EXISTS settings (
              key   TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            PRAGMA user_version = 1;
            "#,
        )?;
    }
    if version < 2 {
        // Phase 2: richer metadata, ratings, content hashing, rule-based smart playlists.
        conn.execute_batch(
            r#"
            ALTER TABLE tracks ADD COLUMN album_artist  TEXT;
            ALTER TABLE tracks ADD COLUMN track_no      INTEGER;
            ALTER TABLE tracks ADD COLUMN disc_no       INTEGER;
            ALTER TABLE tracks ADD COLUMN composer      TEXT;
            ALTER TABLE tracks ADD COLUMN bpm           REAL;
            ALTER TABLE tracks ADD COLUMN rg_track_gain REAL;
            ALTER TABLE tracks ADD COLUMN rg_album_gain REAL;
            ALTER TABLE tracks ADD COLUMN rating        INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE tracks ADD COLUMN content_hash  TEXT;
            CREATE INDEX IF NOT EXISTS idx_tracks_hash ON tracks(content_hash);

            ALTER TABLE playlists ADD COLUMN is_smart    INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE playlists ADD COLUMN smart_rules TEXT;
            PRAGMA user_version = 2;
            "#,
        )?;
    }
    if version < 3 {
        // Phase 3: Google Drive index + two-tier download cache.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS drive_files (
              file_id       TEXT PRIMARY KEY,
              name          TEXT NOT NULL,
              size          INTEGER NOT NULL DEFAULT 0,
              md5           TEXT,
              mime_type     TEXT,
              folder_path   TEXT,
              modified_time INTEGER,
              trashed       INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_drive_files_name ON drive_files(name);

            CREATE TABLE IF NOT EXISTS drive_folders (
              folder_id TEXT PRIMARY KEY,
              name      TEXT NOT NULL,
              parent_id TEXT,
              path      TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cache_entries (
              file_id     TEXT PRIMARY KEY,
              path        TEXT NOT NULL,
              size        INTEGER NOT NULL,
              pinned      INTEGER NOT NULL DEFAULT 0,
              last_access INTEGER NOT NULL,
              created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cache_lru ON cache_entries(pinned, last_access);

            ALTER TABLE tracks ADD COLUMN drive_file_id TEXT;
            CREATE INDEX IF NOT EXISTS idx_tracks_drive ON tracks(drive_file_id);
            PRAGMA user_version = 3;
            "#,
        )?;
    }
    if version < 4 {
        // Phase 4: sync engine — persisted outbox (survives crashes), pull
        // cursors, and a shadow mirror of remote rows (see docs/sync-protocol.md).
        //
        // playlist_tracks loses its FK to tracks(id): synced playlists can
        // reference cloud-only tracks ("drive:<fileId>" ids) that have no
        // local library row until they are downloaded.
        conn.execute_batch(
            r#"
            CREATE TABLE playlist_tracks_v4 (
              playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
              track_id    TEXT NOT NULL,
              position    INTEGER NOT NULL,
              PRIMARY KEY (playlist_id, track_id)
            );
            INSERT INTO playlist_tracks_v4 SELECT playlist_id, track_id, position FROM playlist_tracks;
            DROP TABLE playlist_tracks;
            ALTER TABLE playlist_tracks_v4 RENAME TO playlist_tracks;
            CREATE INDEX IF NOT EXISTS idx_pt_order ON playlist_tracks(playlist_id, position);

            CREATE TABLE IF NOT EXISTS sync_outbox (
              id         TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              payload    TEXT NOT NULL,
              attempts   INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_outbox_created ON sync_outbox(created_at);

            CREATE TABLE IF NOT EXISTS sync_cursors (
              name  TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_shadow (
              entity  TEXT NOT NULL,
              id      TEXT NOT NULL,
              payload TEXT NOT NULL,
              PRIMARY KEY (entity, id)
            );
            PRAGMA user_version = 4;
            "#,
        )?;
    }
    if version < 5 {
        // Phase 7: local play-event log. Statistics are derived from these
        // rows (plus the synced play_events shadow when signed in). Device-
        // owned history: deliberately NOT wiped on sign-out, unlike sync_*.
        // track_id is the *local* library id (may be "drive:<fileId>"); id is
        // shared with the playEvent.add sync op so merged sources dedupe.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS play_events (
              id              TEXT PRIMARY KEY,
              track_id        TEXT NOT NULL,
              played_at       INTEGER NOT NULL,
              duration_played REAL NOT NULL DEFAULT 0,
              completed       INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_play_events_time ON play_events(played_at);
            PRAGMA user_version = 5;
            "#,
        )?;
    }
    if version < 6 {
        // Phase 8: folder roots the user imported, re-watched at startup for
        // live library updates (notify crate).
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS watched_folders (
              path     TEXT PRIMARY KEY,
              added_at INTEGER NOT NULL DEFAULT 0
            );
            PRAGMA user_version = 6;
            "#,
        )?;
    }
    if version < 7 {
        // Records the Drive md5 a cached copy was downloaded at, so a file whose
        // content later changes (edited tags/audio, same fileId) is detected as
        // stale and re-fetched — which re-extracts and re-publishes its metadata.
        // Backfill existing downloads from the current index as their baseline.
        conn.execute_batch(
            r#"
            ALTER TABLE cache_entries ADD COLUMN source_md5 TEXT;
            UPDATE cache_entries
              SET source_md5 = (SELECT md5 FROM drive_files WHERE drive_files.file_id = cache_entries.file_id)
              WHERE source_md5 IS NULL;
            PRAGMA user_version = 7;
            "#,
        )?;
    }
    if version < 8 {
        // Cover art extracted from a downloaded Drive file, so cloud-only
        // tracks render art instead of the placeholder. Its own table rather
        // than a drive_files column: the index is cleared and rebuilt on a
        // rescan, and cache_entries rows die on eviction — art (a few KB,
        // content-addressed and shared between tracks) should outlive both.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS drive_artwork (
              file_id TEXT PRIMARY KEY,
              artwork TEXT NOT NULL
            );
            PRAGMA user_version = 8;
            "#,
        )?;
    }
    if version < 9 {
        // Google Drive and local-folder libraries are retired, and the library
        // was rebuilt from scratch online (docs/drive-to-r2-migration.md,
        // decision 8). Drop their tables and clear everything that described
        // the old library — playlists, play history, sync state, cached audio —
        // so nothing stale syncs back. Device settings stay.
        let cached: Vec<String> = {
            let mut stmt = conn.prepare("SELECT path FROM cache_entries")?;
            let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
            rows
        };
        conn.execute_batch(
            r#"
            BEGIN;
            DROP TABLE IF EXISTS drive_files;
            DROP TABLE IF EXISTS drive_folders;
            DROP TABLE IF EXISTS drive_artwork;
            DROP TABLE IF EXISTS watched_folders;
            DROP TABLE IF EXISTS tracks;
            DELETE FROM playlist_tracks;
            DELETE FROM playlists;
            DELETE FROM play_events;
            DELETE FROM sync_outbox;
            DELETE FROM sync_cursors;
            DELETE FROM sync_shadow;
            DELETE FROM cache_entries;
            ALTER TABLE cache_entries DROP COLUMN source_md5;
            UPDATE settings SET key = 'cache_max_bytes' WHERE key = 'drive_cache_max_bytes';
            DELETE FROM settings WHERE key LIKE 'drive_%';
            PRAGMA user_version = 9;
            COMMIT;
            "#,
        )?;
        // The files go once nothing points at them.
        for path in cached {
            let _ = std::fs::remove_file(path);
        }
        tracing::info!("library reset for the vault (schema v9)");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("mv-db-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("library.db");
        (dir, path)
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        count(conn, &format!("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{name}'")) > 0
    }

    #[test]
    fn fresh_db_migrates_to_latest_without_drive_or_folder_tables() {
        let (_dir, path) = temp_db("fresh");
        let db = open(&path).expect("fresh migration");
        let conn = db.0.lock().unwrap();
        assert_eq!(count(&conn, "PRAGMA user_version"), SCHEMA_VERSION);
        for gone in ["tracks", "drive_files", "drive_folders", "drive_artwork", "watched_folders"] {
            assert!(!table_exists(&conn, gone), "{gone} should be gone");
        }

        // Playlists hold vault ids, and entries cascade with their playlist.
        conn.execute("INSERT INTO playlists (id, name, created_at) VALUES ('p1', 'P', 0)", []).unwrap();
        conn.execute("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p1', 'vault:abc', 0)", [])
            .unwrap();
        conn.execute("DELETE FROM playlists WHERE id = 'p1'", []).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM playlist_tracks"), 0);

        // Sync storage and the play-event log take rows; events replay idempotently.
        conn.execute("INSERT INTO sync_outbox (id, created_at, payload) VALUES ('op1', 'x', '{}')", []).unwrap();
        conn.execute("INSERT INTO sync_shadow (entity, id, payload) VALUES ('tracks', 't1', '{}')", []).unwrap();
        conn.execute("INSERT INTO sync_cursors (name, value) VALUES ('tracks', 'x')", []).unwrap();
        for _ in 0..2 {
            conn.execute(
                "INSERT OR IGNORE INTO play_events (id, track_id, played_at, duration_played, completed) \
                 VALUES ('e1', 'vault:abc', 1752600000000, 210.5, 1)",
                [],
            )
            .unwrap();
        }
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM play_events"), 1);
    }

    #[test]
    fn upgrading_from_v8_clears_the_old_library_and_keeps_settings() {
        let (dir, path) = temp_db("upgrade");
        let cached = dir.join("f1.flac");
        std::fs::write(&cached, b"old drive audio").unwrap();
        {
            // A v8 database: Drive + folder tables, an old library, settings.
            let db = open(&path).unwrap();
            let conn = db.0.lock().unwrap();
            conn.execute_batch(&format!(
                r#"
                CREATE TABLE tracks (id TEXT PRIMARY KEY);
                CREATE TABLE drive_files (file_id TEXT PRIMARY KEY);
                CREATE TABLE watched_folders (path TEXT PRIMARY KEY);
                ALTER TABLE cache_entries ADD COLUMN source_md5 TEXT;
                INSERT INTO tracks VALUES ('C:\\Music\\a.flac');
                INSERT INTO drive_files VALUES ('f1');
                INSERT INTO playlists (id, name, created_at) VALUES ('p1', 'English', 0);
                INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p1', 'drive:f1', 0);
                INSERT INTO play_events (id, track_id, played_at) VALUES ('e1', 'drive:f1', 1);
                INSERT INTO sync_shadow (entity, id, payload) VALUES ('playlists', 'p1', '{{}}');
                INSERT INTO sync_cursors (name, value) VALUES ('seeded', 'x');
                INSERT INTO cache_entries (file_id, path, size, pinned, last_access, created_at, source_md5)
                  VALUES ('f1', '{}', 15, 1, 0, 0, 'abc');
                INSERT INTO settings (key, value) VALUES ('drive_cache_max_bytes', '123'),
                  ('drive_account_email', 'me@example.com'), ('settings', '{{"theme":"dark"}}');
                PRAGMA user_version = 8;
                "#,
                cached.to_string_lossy().replace('\\', "\\\\"),
            ))
            .unwrap();
        }

        let db = open(&path).expect("v9 upgrade");
        let conn = db.0.lock().unwrap();
        assert_eq!(count(&conn, "PRAGMA user_version"), 9);
        assert!(!table_exists(&conn, "tracks") && !table_exists(&conn, "drive_files") && !table_exists(&conn, "watched_folders"));
        for table in ["playlists", "playlist_tracks", "play_events", "sync_shadow", "sync_cursors", "cache_entries"] {
            assert_eq!(count(&conn, &format!("SELECT COUNT(*) FROM {table}")), 0, "{table} should be empty");
        }
        assert!(!cached.exists(), "cached audio is deleted with its index row");
        assert_eq!(queries::get_setting(&conn, "cache_max_bytes").unwrap().as_deref(), Some("123"));
        assert_eq!(queries::get_setting(&conn, "drive_account_email").unwrap(), None);
        assert_eq!(queries::get_setting(&conn, "settings").unwrap().as_deref(), Some(r#"{"theme":"dark"}"#));
    }
}
