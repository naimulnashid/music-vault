use rusqlite::{params, Connection, OptionalExtension, Row};

use super::models::PlaylistRow;
use crate::error::AppResult;

// ---- watched folders (Phase 8 live library updates) ---------------------------

// ---- playlists --------------------------------------------------------------

pub fn get_all_playlists(conn: &Connection) -> AppResult<Vec<PlaylistRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, is_smart, smart_rules FROM playlists ORDER BY created_at",
    )?;
    let mut playlists = stmt
        .query_map([], |row| {
            Ok(PlaylistRow {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                track_ids: Vec::new(),
                is_smart: row.get::<_, i64>(3)? != 0,
                smart_rules: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut stmt = conn.prepare(
        "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position",
    )?;
    for playlist in &mut playlists {
        playlist.track_ids = stmt
            .query_map(params![playlist.id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
    }
    Ok(playlists)
}

pub fn create_playlist(
    conn: &Connection,
    id: &str,
    name: &str,
    created_at: i64,
    smart_rules: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO playlists (id, name, created_at, is_smart, smart_rules)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, created_at, smart_rules.is_some() as i64, smart_rules],
    )?;
    Ok(())
}

pub fn set_playlist_rules(conn: &Connection, id: &str, smart_rules: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE playlists SET smart_rules = ?2, is_smart = 1 WHERE id = ?1",
        params![id, smart_rules],
    )?;
    Ok(())
}

pub fn rename_playlist(conn: &Connection, id: &str, name: &str) -> AppResult<()> {
    conn.execute("UPDATE playlists SET name = ?2 WHERE id = ?1", params![id, name])?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(())
}

/// Replace a playlist's full track list — covers add, remove, and reorder.
pub fn set_playlist_tracks(conn: &mut Connection, id: &str, track_ids: &[String]) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", params![id])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
        )?;
        for (i, track_id) in track_ids.iter().enumerate() {
            stmt.execute(params![id, track_id, i as i64])?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ---- settings ---------------------------------------------------------------

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let value = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
        .optional()?;
    Ok(value)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ---- download cache -----------------------------------------------------------

pub fn get_cache_entry(conn: &Connection, file_id: &str) -> AppResult<Option<super::models::CacheEntryRow>> {
    let row = conn
        .query_row(
            "SELECT file_id, path, size, pinned, last_access, created_at
             FROM cache_entries WHERE file_id = ?1",
            params![file_id],
            row_to_cache_entry,
        )
        .optional()?;
    Ok(row)
}

fn row_to_cache_entry(row: &Row<'_>) -> rusqlite::Result<super::models::CacheEntryRow> {
    Ok(super::models::CacheEntryRow {
        file_id: row.get(0)?,
        path: row.get(1)?,
        size: row.get(2)?,
        pinned: row.get::<_, i64>(3)? != 0,
        last_access: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub fn list_cache_entries(conn: &Connection) -> AppResult<Vec<super::models::CacheEntryRow>> {
    let mut stmt = conn.prepare(
        "SELECT file_id, path, size, pinned, last_access, created_at
         FROM cache_entries ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_cache_entry)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn upsert_cache_entry(
    conn: &Connection,
    file_id: &str,
    path: &str,
    size: i64,
    pinned: bool,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO cache_entries (file_id, path, size, pinned, last_access, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(file_id) DO UPDATE SET path = excluded.path, size = excluded.size,
           pinned = excluded.pinned, last_access = excluded.last_access",
        params![file_id, path, size, pinned as i64, now],
    )?;
    Ok(())
}

pub fn touch_cache_entry(conn: &Connection, file_id: &str, now: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE cache_entries SET last_access = ?2 WHERE file_id = ?1",
        params![file_id, now],
    )?;
    Ok(())
}

pub fn set_cache_entry_pinned(conn: &Connection, file_id: &str, path: &str, pinned: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE cache_entries SET pinned = ?3, path = ?2 WHERE file_id = ?1",
        params![file_id, path, pinned as i64],
    )?;
    Ok(())
}

pub fn delete_cache_entry(conn: &Connection, file_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM cache_entries WHERE file_id = ?1", params![file_id])?;
    Ok(())
}

/// (auto_bytes, pinned_bytes) currently on disk per the index.
pub fn cache_usage(conn: &Connection) -> AppResult<(i64, i64)> {
    let auto: i64 = conn.query_row(
        "SELECT COALESCE(SUM(size), 0) FROM cache_entries WHERE pinned = 0",
        [],
        |r| r.get(0),
    )?;
    let pinned: i64 = conn.query_row(
        "SELECT COALESCE(SUM(size), 0) FROM cache_entries WHERE pinned = 1",
        [],
        |r| r.get(0),
    )?;
    Ok((auto, pinned))
}

/// Unpinned entries, least-recently-used first — the LRU eviction order.
pub fn cache_lru_entries(conn: &Connection) -> AppResult<Vec<super::models::CacheEntryRow>> {
    let mut stmt = conn.prepare(
        "SELECT file_id, path, size, pinned, last_access, created_at
         FROM cache_entries WHERE pinned = 0 ORDER BY last_access ASC",
    )?;
    let rows = stmt.query_map([], row_to_cache_entry)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---- sync engine storage (Phase 4) -----------------------------------------

use super::models::{SyncOutboxRow, SyncShadowRow};

pub fn sync_outbox_all(conn: &Connection) -> AppResult<Vec<SyncOutboxRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, payload, attempts FROM sync_outbox ORDER BY created_at, id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SyncOutboxRow {
                id: row.get(0)?,
                created_at: row.get(1)?,
                payload: row.get(2)?,
                attempts: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn sync_outbox_put(conn: &Connection, id: &str, created_at: &str, payload: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO sync_outbox (id, created_at, payload) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET created_at = ?2, payload = ?3",
        params![id, created_at, payload],
    )?;
    Ok(())
}

pub fn sync_outbox_delete(conn: &Connection, ids: &[String]) -> AppResult<()> {
    let mut stmt = conn.prepare("DELETE FROM sync_outbox WHERE id = ?1")?;
    for id in ids {
        stmt.execute(params![id])?;
    }
    Ok(())
}

pub fn sync_outbox_bump(conn: &Connection, ids: &[String]) -> AppResult<()> {
    let mut stmt = conn.prepare("UPDATE sync_outbox SET attempts = attempts + 1 WHERE id = ?1")?;
    for id in ids {
        stmt.execute(params![id])?;
    }
    Ok(())
}

pub fn sync_cursor_get(conn: &Connection, name: &str) -> AppResult<Option<String>> {
    let value = conn
        .query_row("SELECT value FROM sync_cursors WHERE name = ?1", params![name], |r| r.get(0))
        .optional()?;
    Ok(value)
}

pub fn sync_cursor_set(conn: &Connection, name: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO sync_cursors (name, value) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET value = ?2",
        params![name, value],
    )?;
    Ok(())
}

pub fn sync_shadow_get(conn: &Connection, entity: &str, id: &str) -> AppResult<Option<String>> {
    let payload = conn
        .query_row(
            "SELECT payload FROM sync_shadow WHERE entity = ?1 AND id = ?2",
            params![entity, id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(payload)
}

pub fn sync_shadow_put(conn: &Connection, entity: &str, id: &str, payload: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO sync_shadow (entity, id, payload) VALUES (?1, ?2, ?3)
         ON CONFLICT(entity, id) DO UPDATE SET payload = ?3",
        params![entity, id, payload],
    )?;
    Ok(())
}

pub fn sync_shadow_delete(conn: &Connection, entity: &str, id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM sync_shadow WHERE entity = ?1 AND id = ?2",
        params![entity, id],
    )?;
    Ok(())
}

pub fn sync_shadow_all(conn: &Connection, entity: &str) -> AppResult<Vec<SyncShadowRow>> {
    let mut stmt = conn.prepare("SELECT id, payload FROM sync_shadow WHERE entity = ?1")?;
    let rows = stmt
        .query_map(params![entity], |row| {
            Ok(SyncShadowRow { id: row.get(0)?, payload: row.get(1)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Sign-out/account switch: forget everything sync-related.
pub fn sync_clear_all(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM sync_outbox; DELETE FROM sync_cursors; DELETE FROM sync_shadow;",
    )?;
    Ok(())
}

// ---- local play-event log (Phase 7) -----------------------------------------

use super::models::PlayEventLocalRow;

/// Append-only and idempotent: replaying the same event id is a no-op.
pub fn play_event_add(
    conn: &Connection,
    id: &str,
    track_id: &str,
    played_at: i64,
    duration_played: f64,
    completed: bool,
) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO play_events (id, track_id, played_at, duration_played, completed) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, track_id, played_at, duration_played, completed as i64],
    )?;
    Ok(())
}

pub fn play_events_all(conn: &Connection) -> AppResult<Vec<PlayEventLocalRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, track_id, played_at, duration_played, completed FROM play_events ORDER BY played_at",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PlayEventLocalRow {
                id: row.get(0)?,
                track_id: row.get(1)?,
                played_at: row.get(2)?,
                duration_played: row.get(3)?,
                completed: row.get::<_, i64>(4)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
