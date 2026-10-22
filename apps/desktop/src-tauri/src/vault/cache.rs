//! Two-tier cache of vault audio on this device, keyed `vault:<contentHash>`.
//!
//! Tier 1 (auto-cache): files land here when a track is first played;
//! LRU-evicted to keep the tier under a configurable size cap.
//! Tier 2 (pinned downloads): explicit downloads; never auto-evicted. They
//! live in the app-data `downloads` folder unless the owner picks another
//! ([`SETTING_DOWNLOADS_DIR`]).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::db::{queries, Db};
use crate::error::AppResult;

pub const SETTING_CACHE_MAX: &str = "cache_max_bytes";
/// The folder pinned downloads go to, when not the default. Kept in this
/// device's database only: it is a path on this PC.
pub const SETTING_DOWNLOADS_DIR: &str = "downloads_dir";
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
    let path = Path::new(&entry.path);
    if !path.exists() {
        // A missing folder is a download folder on a drive that isn't plugged
        // in: keep the row so the file counts again once the drive is back.
        if path.parent().is_some_and(Path::exists) {
            queries::delete_cache_entry(conn, file_id)?;
        }
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

/// Deletes a file, treating "already gone" as done. Any other failure (the file
/// is open, access denied) leaves it on disk, so its row must stay too.
fn delete_file(path: &str) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Deletes a cached/downloaded file and its index row. When the file can't be
/// deleted the row stays, so Downloads and the usage figures keep counting it.
pub fn remove(conn: &Connection, file_id: &str) -> AppResult<()> {
    if let Some(entry) = queries::get_cache_entry(conn, file_id)? {
        delete_file(&entry.path)?;
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
            // A file in use stays (with its row) and is tried again next time.
            match remove(conn, &key) {
                Ok(()) => removed += 1,
                Err(e) => tracing::warn!(key = %key, error = %e, "couldn't remove a deleted track's file"),
            }
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
        // Keep the row while the file can't go (open elsewhere), so the usage stays true.
        if delete_file(&entry.path).is_err() {
            continue;
        }
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

/// The download folder the owner picked, if any.
pub fn custom_downloads_dir(conn: &Connection) -> Option<PathBuf> {
    queries::get_setting(conn, SETTING_DOWNLOADS_DIR)
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// The parts of a cache file name (`<hash>.<ext>`) a caller passes in; anything
/// else could point outside the cache folder.
pub fn valid_file_parts(content_hash: &str, ext: &str) -> bool {
    content_hash.len() == 64
        && content_hash.chars().all(|c| c.is_ascii_hexdigit())
        && !ext.is_empty()
        && ext.len() <= 8
        && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Copies `from` to `to` while hashing it, calling `on_bytes` per chunk.
/// Returns the size when the copy hashes to `expected`; otherwise (or on any
/// error) `to` is removed, so a wrong or partial copy is never left behind.
pub(crate) fn copy_verified(from: &Path, to: &Path, expected: &str, on_bytes: &mut dyn FnMut(usize)) -> std::io::Result<Option<i64>> {
    let mut src = std::fs::File::open(from)?;
    let mut dst = std::fs::File::create(to)?;
    let copied = (|| {
        let mut hasher = blake3::Hasher::new();
        let mut buf = vec![0u8; 256 * 1024];
        let mut size: i64 = 0;
        loop {
            let n = src.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            dst.write_all(&buf[..n])?;
            size += n as i64;
            on_bytes(n);
        }
        dst.flush()?;
        Ok((hasher.finalize().to_hex().as_str() == expected).then_some(size))
    })();
    drop(dst);
    if !matches!(copied, Ok(Some(_))) {
        let _ = std::fs::remove_file(to);
    }
    copied
}

/// Puts a file this device just uploaded into the cache as `<hash>.<ext>` in
/// `dir`, so its first play here doesn't fetch it back from the vault. The
/// copy is checked against the hash like a download. Returns false, having
/// done nothing, when the track is cached already, the auto-cache is off, the
/// file has gone, or it no longer has the hash it was uploaded with.
pub fn adopt_upload(db: &Db, source: &Path, content_hash: &str, ext: &str, dir: &Path, pin: bool) -> AppResult<bool> {
    let key = super::cache_key(content_hash);
    {
        let conn = db.0.lock().expect("db lock");
        if resolve_cached(&conn, &key)?.is_some() {
            return Ok(false);
        }
        // With the cache off, a new entry would only push the playing song out.
        if !pin && cache_max_bytes(&conn) == 0 {
            return Ok(false);
        }
    }
    let target = dir.join(format!("{content_hash}.{ext}"));
    let temp = target.with_extension(format!("{ext}.part"));
    let size = match copy_verified(source, &temp, content_hash, &mut |_| {}) {
        Ok(Some(size)) => size,
        Ok(None) => return Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    if let Err(e) = std::fs::rename(&temp, &target) {
        let _ = std::fs::remove_file(&temp);
        return Err(e.into());
    }
    let conn = db.0.lock().expect("db lock");
    register_download(&conn, &key, &target, size, pin)?;
    Ok(true)
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MoveProgress {
    /// Downloads handled so far (moved, failed or already gone).
    pub done: usize,
    pub total: usize,
    pub bytes: i64,
    pub total_bytes: i64,
}

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveReport {
    pub moved: usize,
    /// Downloads that stayed in the old folder (in use, disk full); still indexed there.
    pub failed: usize,
}

/// Moves one download: a rename on the same drive, else a verified copy and
/// then the original deleted. If the original can't go, the copy goes instead.
fn move_file(from: &Path, to: &Path, content_hash: &str, on_bytes: &mut dyn FnMut(usize)) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    if !from.exists() {
        return Err(std::io::ErrorKind::NotFound.into());
    }
    let ext = to.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    let temp = to.with_extension(format!("{ext}.part"));
    match copy_verified(from, &temp, content_hash, on_bytes)? {
        Some(_) => {}
        None => return Err(std::io::Error::other("the download doesn't match its hash")),
    }
    if let Err(e) = std::fs::rename(&temp, to) {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
    }
    if let Err(e) = std::fs::remove_file(from) {
        let _ = std::fs::remove_file(to);
        return Err(e);
    }
    Ok(())
}

/// Moves every pinned download into `to` and points its index row there,
/// one file at a time, so a crash part-way leaves every row true. A file
/// that can't move stays where it is, still indexed, and keeps playing.
pub fn move_pinned(db: &Db, to: &Path, mut on_progress: impl FnMut(&MoveProgress)) -> AppResult<MoveReport> {
    std::fs::create_dir_all(to)?;
    let entries: Vec<_> = {
        let conn = db.0.lock().expect("db lock");
        queries::list_cache_entries(&conn)?.into_iter().filter(|e| e.pinned).collect()
    };
    let mut progress = MoveProgress {
        total: entries.len(),
        total_bytes: entries.iter().map(|e| e.size).sum(),
        ..Default::default()
    };
    let mut report = MoveReport::default();
    on_progress(&progress);
    for entry in entries {
        let from = PathBuf::from(&entry.path);
        let start_bytes = progress.bytes;
        let target = from.file_name().map(|name| to.join(name));
        match target {
            Some(target) if target == from => report.moved += 1,
            Some(target) => {
                let hash = entry.file_id.strip_prefix("vault:").unwrap_or(&entry.file_id);
                let mut on_bytes = |n: usize| {
                    progress.bytes += n as i64;
                    on_progress(&progress);
                };
                match move_file(&from, &target, hash, &mut on_bytes) {
                    Ok(()) => {
                        let conn = db.0.lock().expect("db lock");
                        queries::set_cache_entry_pinned(&conn, &entry.file_id, &target.to_string_lossy(), true)?;
                        report.moved += 1;
                    }
                    // Already gone: playing it drops the row, as for any vanished file.
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        tracing::warn!(file_id = %entry.file_id, error = %e, "couldn't move a download");
                        report.failed += 1;
                    }
                }
            }
            None => report.failed += 1,
        }
        progress.done += 1;
        progress.bytes = start_bytes + entry.size;
        on_progress(&progress);
    }
    Ok(report)
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
    fn remove_keeps_the_row_when_the_file_cannot_be_deleted() {
        let (db, dir) = test_db("stuck");
        let conn = db.0.lock().unwrap();
        // A directory can't be removed with remove_file: stands in for a locked file.
        let stuck = dir.join("stuck.flac");
        std::fs::create_dir_all(&stuck).unwrap();
        queries::upsert_cache_entry(&conn, "vault:stuck", &stuck.to_string_lossy(), 5, true, 1).unwrap();
        assert!(remove(&conn, "vault:stuck").is_err());
        assert!(queries::get_cache_entry(&conn, "vault:stuck").unwrap().is_some());
    }

    #[test]
    fn remove_drops_the_row_when_the_file_is_already_gone() {
        let (db, dir) = test_db("gone");
        let conn = db.0.lock().unwrap();
        let missing = dir.join("missing.flac");
        queries::upsert_cache_entry(&conn, "vault:gone", &missing.to_string_lossy(), 5, true, 1).unwrap();
        remove(&conn, "vault:gone").unwrap();
        assert!(queries::get_cache_entry(&conn, "vault:gone").unwrap().is_none());
    }

    #[test]
    fn enforce_cap_skips_a_file_it_cannot_delete() {
        let (db, dir) = test_db("capstuck");
        let conn = db.0.lock().unwrap();
        queries::set_setting(&conn, SETTING_CACHE_MAX, "0").unwrap();
        let stuck = dir.join("old.mp3");
        std::fs::create_dir_all(&stuck).unwrap();
        queries::upsert_cache_entry(&conn, "old", &stuck.to_string_lossy(), 100, false, 1).unwrap();
        for i in 0..KEEP_RECENT {
            seed_auto(&conn, &dir, &format!("recent{i}"), 1, 10_000 + i as i64);
        }
        enforce_cap(&conn).unwrap();
        assert!(queries::get_cache_entry(&conn, "old").unwrap().is_some());
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

    fn hash_of(bytes: &[u8]) -> String {
        blake3::hash(bytes).to_hex().to_string()
    }

    #[test]
    fn adopt_upload_copies_the_uploaded_file_into_the_cache() {
        let (db, dir) = test_db("adopt");
        let cache_dir = dir.join("audio-cache");
        std::fs::create_dir_all(&cache_dir).unwrap();
        let source = dir.join("My Song.flac");
        std::fs::write(&source, b"uploaded bytes").unwrap();
        let hash = hash_of(b"uploaded bytes");

        assert!(adopt_upload(&db, &source, &hash, "flac", &cache_dir, false).unwrap());

        let conn = db.0.lock().unwrap();
        let entry = queries::get_cache_entry(&conn, &super::super::cache_key(&hash)).unwrap().unwrap();
        assert_eq!(Path::new(&entry.path), cache_dir.join(format!("{hash}.flac")));
        assert_eq!(std::fs::read(&entry.path).unwrap(), b"uploaded bytes");
        assert!(!entry.pinned && entry.size == 14);
        assert!(source.exists(), "the original stays where it was");
        drop(conn);
        // A second call (a retried upload) leaves the cached copy alone.
        assert!(!adopt_upload(&db, &source, &hash, "flac", &cache_dir, false).unwrap());
    }

    #[test]
    fn adopt_upload_skips_a_file_that_moved_or_changed() {
        let (db, dir) = test_db("adoptskip");
        let hash = hash_of(b"original");
        let changed = dir.join("changed.mp3");
        std::fs::write(&changed, b"re-saved").unwrap();

        assert!(!adopt_upload(&db, &dir.join("moved.mp3"), &hash, "mp3", &dir, false).unwrap());
        assert!(!adopt_upload(&db, &changed, &hash, "mp3", &dir, false).unwrap());

        let conn = db.0.lock().unwrap();
        assert!(queries::get_cache_entry(&conn, &super::super::cache_key(&hash)).unwrap().is_none());
        assert!(!dir.join(format!("{hash}.mp3")).exists());
        assert!(!dir.join(format!("{hash}.mp3.part")).exists(), "no partial copy is left");
    }

    #[test]
    fn adopt_upload_with_the_cache_off_only_keeps_downloads() {
        let (db, dir) = test_db("adoptoff");
        queries::set_setting(&db.0.lock().unwrap(), SETTING_CACHE_MAX, "0").unwrap();
        let source = dir.join("song.ogg");
        std::fs::write(&source, b"ogg").unwrap();
        let hash = hash_of(b"ogg");

        assert!(!adopt_upload(&db, &source, &hash, "ogg", &dir, false).unwrap());
        assert!(adopt_upload(&db, &source, &hash, "ogg", &dir, true).unwrap());
        let conn = db.0.lock().unwrap();
        assert!(queries::get_cache_entry(&conn, &super::super::cache_key(&hash)).unwrap().unwrap().pinned);
    }

    #[test]
    fn file_parts_must_be_a_hash_and_a_plain_extension() {
        let hash = "ab".repeat(32);
        assert!(valid_file_parts(&hash, "flac"));
        assert!(!valid_file_parts(&hash, "../x"));
        assert!(!valid_file_parts(&hash, ""));
        assert!(!valid_file_parts("..\\evil", "flac"));
        assert!(!valid_file_parts(&"g".repeat(64), "flac"));
    }

    #[test]
    fn move_pinned_moves_downloads_and_their_rows_but_not_the_auto_tier() {
        let (db, dir) = test_db("move");
        let old = dir.join("downloads");
        let new = dir.join("elsewhere").join("Music Vault");
        std::fs::create_dir_all(&old).unwrap();
        let (h1, h2, h3) = (hash_of(b"one"), hash_of(b"two"), hash_of(b"gone"));
        {
            let conn = db.0.lock().unwrap();
            for (hash, bytes) in [(&h1, &b"one"[..]), (&h2, &b"two"[..])] {
                let path = old.join(format!("{hash}.flac"));
                std::fs::write(&path, bytes).unwrap();
                register_download(&conn, &super::super::cache_key(hash), &path, 3, true).unwrap();
            }
            // Indexed but deleted by hand: skipped, not a failure.
            let missing = old.join(format!("{h3}.flac"));
            register_download(&conn, &super::super::cache_key(&h3), &missing, 4, true).unwrap();
            seed_auto(&conn, &dir, "auto", 5, 1);
        }

        let mut seen = Vec::new();
        let report = move_pinned(&db, &new, |p| seen.push(p.clone())).unwrap();

        assert_eq!(report, MoveReport { moved: 2, failed: 0 });
        let last = seen.last().unwrap();
        assert_eq!((last.done, last.total, last.bytes, last.total_bytes), (3, 3, 10, 10));
        let conn = db.0.lock().unwrap();
        for (hash, bytes) in [(&h1, &b"one"[..]), (&h2, &b"two"[..])] {
            let entry = queries::get_cache_entry(&conn, &super::super::cache_key(hash)).unwrap().unwrap();
            assert_eq!(Path::new(&entry.path), new.join(format!("{hash}.flac")));
            assert_eq!(std::fs::read(&entry.path).unwrap(), bytes);
            assert!(!old.join(format!("{hash}.flac")).exists());
        }
        assert!(dir.join("auto.mp3").exists(), "the auto-cache stays put");
    }

    #[test]
    fn move_file_copies_when_it_cannot_rename_and_rejects_a_bad_copy() {
        let (_db, dir) = test_db("movecopy");
        let from = dir.join("a.flac");
        std::fs::write(&from, b"bytes").unwrap();
        let to = dir.join("missing-folder").join("a.flac");
        // Renaming into a folder that doesn't exist fails, like a move across drives.
        assert!(move_file(&from, &to, &hash_of(b"bytes"), &mut |_| {}).is_err());
        assert!(from.exists(), "a failed move keeps the original");

        let to = dir.join("b").join("a.flac");
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        let mut copied = 0;
        let ok = move_file(&from, &to, &hash_of(b"bytes"), &mut |n| copied += n);
        assert!(ok.is_ok() && to.exists() && !from.exists());
        assert!(copied == 0 || copied == 5);

        assert_eq!(copy_verified(&to, &dir.join("c.flac"), &hash_of(b"other"), &mut |_| {}).unwrap(), None);
        assert!(!dir.join("c.flac").exists(), "a copy that doesn't match is removed");
    }

    #[test]
    fn resolve_keeps_the_row_while_the_download_folder_is_missing() {
        let (db, dir) = test_db("unplugged");
        let conn = db.0.lock().unwrap();
        let path = dir.join("unplugged-drive").join("song.flac");
        queries::upsert_cache_entry(&conn, "vault:x", &path.to_string_lossy(), 5, true, 1).unwrap();
        assert!(resolve_cached(&conn, "vault:x").unwrap().is_none());
        assert!(queries::get_cache_entry(&conn, "vault:x").unwrap().is_some());
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
