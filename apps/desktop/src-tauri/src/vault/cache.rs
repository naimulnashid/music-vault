//! Two-tier cache of vault audio on this device, keyed `vault:<contentHash>`.
//!
//! Tier 1 (auto-cache): files land here when a track is first played;
//! LRU-evicted to keep the tier under a configurable size cap.
//! Tier 2 (pinned downloads): explicit downloads; never auto-evicted.

use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;

use crate::db::queries;
use crate::error::AppResult;

pub const SETTING_CACHE_MAX: &str = "cache_max_bytes";
/// Default and largest allowed cap. 0 turns the auto-cache off.
pub const DEFAULT_CACHE_MAX: i64 = 10 * 1024 * 1024 * 1024; // 10 GiB
pub const MAX_CACHE_MAX: i64 = DEFAULT_CACHE_MAX;
/// The most recently used auto entries are never evicted: the song playing and
/// the one preloaded after it must stay on disk, even with the cache off.
const KEEP_RECENT: usize = 2;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Returns the local path for a cached track if it is present on disk,
/// bumping its LRU recency. Cleans up stale index rows whose file vanished.
pub fn resolve_cached(conn: &Connection, file_id: &str) -> AppResult<Option<String>> {
    let Some(entry) = queries::get_cache_entry(conn, file_id)? else {
        return Ok(None);
    };
    if !Path::new(&entry.path).exists() {
        queries::delete_cache_entry(conn, file_id)?;
        return Ok(None);
    }
    queries::touch_cache_entry(conn, file_id, now_ms())?;
    Ok(Some(entry.path))
}

/// Registers a completed download in the index and, for the auto tier,
/// evicts least-recently-used entries down to the size cap.
pub fn register_download(
    conn: &Connection,
    file_id: &str,
    path: &Path,
    size: i64,
    pinned: bool,
) -> AppResult<()> {
    queries::upsert_cache_entry(conn, file_id, &path.to_string_lossy(), size, pinned, now_ms())?;
    if !pinned {
        enforce_cap(conn)?;
    }
    Ok(())
}

/// Moves an auto-cached file into the pinned downloads tier (no re-download).
pub fn promote_to_pinned(conn: &Connection, file_id: &str, from: &str, downloads_dir: &Path) -> AppResult<String> {
    let file_name = Path::new(from)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_id.to_string());
    let target = downloads_dir.join(&file_name);
    if from != target.to_string_lossy() {
        std::fs::rename(from, &target)?;
    }
    let target_str = target.to_string_lossy().to_string();
    queries::set_cache_entry_pinned(conn, file_id, &target_str, true)?;
    Ok(target_str)
}

/// Deletes a cached/downloaded file and its index row.
pub fn remove(conn: &Connection, file_id: &str) -> AppResult<()> {
    if let Some(entry) = queries::get_cache_entry(conn, file_id)? {
        let _ = std::fs::remove_file(&entry.path);
        queries::delete_cache_entry(conn, file_id)?;
    }
    Ok(())
}

/// Drops cached and pinned copies of tracks deleted from the vault (here or
/// on another device). Returns how many were removed.
pub fn forget_deleted(conn: &Connection, content_hashes: &[String]) -> AppResult<usize> {
    let mut removed = 0;
    for hash in content_hashes {
        let key = super::cache_key(hash);
        if queries::get_cache_entry(conn, &key)?.is_some() {
            remove(conn, &key)?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn cache_max_bytes(conn: &Connection) -> i64 {
    queries::get_setting(conn, SETTING_CACHE_MAX)
        .ok()
        .flatten()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(DEFAULT_CACHE_MAX)
        .clamp(0, MAX_CACHE_MAX)
}

/// Evicts LRU auto-tier entries until the tier fits the cap.
pub fn enforce_cap(conn: &Connection) -> AppResult<()> {
    let cap = cache_max_bytes(conn);
    let (mut auto_bytes, _) = queries::cache_usage(conn)?;
    if auto_bytes <= cap {
        return Ok(());
    }
    let entries = queries::cache_lru_entries(conn)?;
    let evictable = entries.len().saturating_sub(KEEP_RECENT);
    for entry in entries.into_iter().take(evictable) {
        if auto_bytes <= cap {
            break;
        }
        let _ = std::fs::remove_file(&entry.path);
        queries::delete_cache_entry(conn, &entry.file_id)?;
        auto_bytes -= entry.size;
        tracing::info!(file_id = %entry.file_id, size = entry.size, "evicted from auto-cache");
    }
    Ok(())
}

/// Empties the auto tier except the [`KEEP_RECENT`] most recent entries
/// (playing / up next). Pinned downloads are untouched. Returns bytes freed.
pub fn clear_auto(conn: &Connection) -> AppResult<i64> {
    let entries = queries::cache_lru_entries(conn)?;
    let evictable = entries.len().saturating_sub(KEEP_RECENT);
    let mut freed = 0;
    for entry in entries.into_iter().take(evictable) {
        let path = Path::new(&entry.path);
        // Keep the row while the file can't go (open elsewhere), so it isn't orphaned on disk.
        if path.exists() && std::fs::remove_file(path).is_err() {
            continue;
        }
        queries::delete_cache_entry(conn, &entry.file_id)?;
        freed += entry.size;
    }
    Ok(freed)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub auto_bytes: i64,
    pub pinned_bytes: i64,
    pub max_bytes: i64,
}

pub fn stats(conn: &Connection) -> AppResult<CacheStats> {
    let (auto_bytes, pinned_bytes) = queries::cache_usage(conn)?;
    Ok(CacheStats {
        auto_bytes,
        pinned_bytes,
        max_bytes: cache_max_bytes(conn),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_db(name: &str) -> (crate::db::Db, PathBuf) {
        let dir = std::env::temp_dir().join(format!("mv-cache-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::open(&dir.join("cache.db")).unwrap();
        (db, dir)
    }

    fn write_file(dir: &Path, name: &str, bytes: usize) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, vec![0u8; bytes]).unwrap();
        path
    }

    /// Insert an auto-tier entry with a controlled LRU timestamp.
    fn seed_auto(conn: &Connection, dir: &Path, file_id: &str, size: i64, accessed_at: i64) -> PathBuf {
        let path = write_file(dir, &format!("{file_id}.mp3"), size as usize);
        queries::upsert_cache_entry(conn, file_id, &path.to_string_lossy(), size, false, accessed_at).unwrap();
        path
    }

    #[test]
    fn forgets_cached_copies_of_deleted_tracks() {
        let (db, dir) = test_db("forget");
        let conn = db.0.lock().unwrap();
        let file = write_file(&dir, "vault-h1.flac", 1);
        queries::upsert_cache_entry(&conn, "vault:h1", &file.to_string_lossy(), 1, true, 1).unwrap();
        assert_eq!(forget_deleted(&conn, &["h1".into(), "h2".into()]).unwrap(), 1);
        assert!(queries::get_cache_entry(&conn, "vault:h1").unwrap().is_none());
        assert!(!file.exists());
    }

    #[test]
    fn enforce_cap_evicts_least_recently_used_first_and_spares_pinned() {
        let (db, dir) = test_db("lru");
        let conn = db.0.lock().unwrap();
        queries::set_setting(&conn, SETTING_CACHE_MAX, "250").unwrap();

        let oldest = seed_auto(&conn, &dir, "a", 100, 1_000);
        let middle = seed_auto(&conn, &dir, "b", 100, 2_000);
        let newest = seed_auto(&conn, &dir, "c", 100, 3_000);
        let pinned = write_file(&dir, "p.flac", 500);
        queries::upsert_cache_entry(&conn, "p", &pinned.to_string_lossy(), 500, true, 500).unwrap();

        // 300 auto bytes > 250 cap: only the LRU entry ("a") must go.
        enforce_cap(&conn).unwrap();

        assert!(!oldest.exists(), "LRU entry should be deleted from disk");
        assert!(middle.exists() && newest.exists(), "newer entries must survive");
        assert!(pinned.exists(), "pinned tier is never auto-evicted");
        assert!(queries::get_cache_entry(&conn, "a").unwrap().is_none());
        let (auto_bytes, pinned_bytes) = queries::cache_usage(&conn).unwrap();
        assert_eq!((auto_bytes, pinned_bytes), (200, 500));
    }

    #[test]
    fn resolve_bumps_recency_so_played_tracks_survive_eviction() {
        let (db, dir) = test_db("touch");
        let conn = db.0.lock().unwrap();
        queries::set_setting(&conn, SETTING_CACHE_MAX, "150").unwrap();

        let a = seed_auto(&conn, &dir, "a", 100, 1_000);
        let b = seed_auto(&conn, &dir, "b", 100, 2_000);
        let c = seed_auto(&conn, &dir, "c", 100, 3_000);

        // Playing "a" bumps it past "b" and "c" (now_ms() >> 3000).
        assert!(resolve_cached(&conn, "a").unwrap().is_some());
        enforce_cap(&conn).unwrap();

        assert!(a.exists() && c.exists(), "the two most recent entries must survive");
        assert!(!b.exists(), "stale entry should be evicted instead");
    }

    #[test]
    fn cap_zero_keeps_only_the_playing_and_next_song() {
        let (db, dir) = test_db("off");
        let conn = db.0.lock().unwrap();
        queries::set_setting(&conn, SETTING_CACHE_MAX, "0").unwrap();
        let old = seed_auto(&conn, &dir, "old", 10, 1_000);
        let playing = seed_auto(&conn, &dir, "playing", 10, 2_000);
        let next = seed_auto(&conn, &dir, "next", 10, 3_000);
        enforce_cap(&conn).unwrap();
        assert!(!old.exists());
        assert!(playing.exists() && next.exists());
    }

    #[test]
    fn clear_auto_spares_pinned_and_recent() {
        let (db, dir) = test_db("clear");
        let conn = db.0.lock().unwrap();
        let a = seed_auto(&conn, &dir, "a", 10, 1_000);
        let b = seed_auto(&conn, &dir, "b", 20, 2_000);
        seed_auto(&conn, &dir, "c", 30, 3_000);
        seed_auto(&conn, &dir, "d", 40, 4_000);
        let pinned = write_file(&dir, "p.flac", 50);
        queries::upsert_cache_entry(&conn, "p", &pinned.to_string_lossy(), 50, true, 500).unwrap();
        assert_eq!(clear_auto(&conn).unwrap(), 30);
        assert!(!a.exists() && !b.exists() && pinned.exists());
        assert_eq!(queries::cache_usage(&conn).unwrap(), (70, 50));
    }

    #[test]
    fn stored_cap_is_clamped_to_the_maximum() {
        let (db, _dir) = test_db("clamp");
        let conn = db.0.lock().unwrap();
        queries::set_setting(&conn, SETTING_CACHE_MAX, &(50i64 * 1024 * 1024 * 1024).to_string()).unwrap();
        assert_eq!(cache_max_bytes(&conn), MAX_CACHE_MAX);
    }

    #[test]
    fn resolve_cleans_up_index_rows_for_vanished_files() {
        let (db, dir) = test_db("stale");
        let conn = db.0.lock().unwrap();

        let path = seed_auto(&conn, &dir, "gone", 10, 1_000);
        std::fs::remove_file(&path).unwrap();

        assert!(resolve_cached(&conn, "gone").unwrap().is_none());
        assert!(queries::get_cache_entry(&conn, "gone").unwrap().is_none(), "stale row must be dropped");
    }

    #[test]
    fn register_download_pinned_skips_cap_and_promote_moves_tiers() {
        let (db, dir) = test_db("pin");
        let conn = db.0.lock().unwrap();
        queries::set_setting(&conn, SETTING_CACHE_MAX, "50").unwrap();

        // A pinned registration larger than the cap must not trigger eviction of itself.
        let big = write_file(&dir, "big.wav", 200);
        register_download(&conn, "big", &big, 200, true).unwrap();
        assert!(big.exists());

        // Promote an auto entry into the downloads dir and flip its tier.
        let auto = seed_auto(&conn, &dir, "song", 10, 1_000);
        let downloads = dir.join("downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        let new_path = promote_to_pinned(&conn, "song", &auto.to_string_lossy(), &downloads).unwrap();

        assert!(!auto.exists() && Path::new(&new_path).exists(), "file should move into downloads dir");
        let (auto_bytes, pinned_bytes) = queries::cache_usage(&conn).unwrap();
        assert_eq!((auto_bytes, pinned_bytes), (0, 210));
    }
}
