//! Byte transfers to and from pre-signed R2 URLs. URLs come from the
//! frontend (which signs them through the `vault` Edge Function); nothing
//! here holds credentials.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::{cache_key, VaultState};
use crate::commands::AppPaths;
use crate::db::{queries, Db};
use super::cache;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UploadProgress {
    upload_id: String,
    sent: u64,
    total: u64,
}

// Downloads reuse the Drive download events (keyed `vault:<hash>`), so the
// existing Downloads view and progress UI cover vault tracks unchanged.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    file_id: String,
    downloaded: i64,
    total: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadDone {
    file_id: String,
    path: String,
    pinned: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadError {
    file_id: String,
    message: String,
}

const CHUNK: usize = 256 * 1024;

/// Error message of a download stopped by [`cancel`]; the frontend matches it.
pub const CANCELLED: &str = "cancelled";

/// Stops in-flight downloads of these cache keys. Keys with no download
/// running are ignored, so a late cancel can't stop a later download.
pub async fn cancel(app: &AppHandle, keys: &[String]) {
    let state = app.state::<VaultState>();
    let locks = state.download_locks.lock().await;
    let mut cancelled = state.cancelled.lock().expect("cancel lock");
    for key in keys {
        if locks.contains_key(key) {
            cancelled.insert(key.clone());
        }
    }
}

/// Error message of an upload whose file no longer matches the hash it was
/// added with; the upload screen shows it as is.
pub const FILE_CHANGED: &str = "This file changed after it was added (it was saved again). Remove it and add it again.";

/// Streams a local file to a pre-signed PUT URL, emitting
/// `vault://upload-progress` about four times a second.
///
/// With `expected_blake3` (audio), the bytes are hashed as they go and the last
/// chunk is withheld if they don't match: the hash names the object and is the
/// track's identity, so a file re-saved since it was added (a tag edit can keep
/// the size) would otherwise be stored under the wrong hash and fail every
/// download. Withholding it aborts the PUT, so R2 keeps nothing.
pub async fn put_file(
    app: &AppHandle,
    url: &str,
    path: &Path,
    upload_id: &str,
    content_type: &str,
    expected_blake3: Option<&str>,
) -> Result<()> {
    let state = app.state::<VaultState>();
    let total = std::fs::metadata(path).with_context(|| format!("can't read {}", path.display()))?.len();
    let file = std::fs::File::open(path)?;

    let emit_app = app.clone();
    let id = upload_id.to_string();
    let expected = expected_blake3.map(str::to_owned);
    let changed = Arc::new(AtomicBool::new(false));
    let changed_in_stream = changed.clone();
    let body = futures_util::stream::unfold(
        (file, 0u64, Instant::now(), false, blake3::Hasher::new()),
        move |(mut file, sent, last, done, mut hasher)| {
            let app = emit_app.clone();
            let id = id.clone();
            let expected = expected.clone();
            let changed = changed_in_stream.clone();
            async move {
                if done {
                    return None;
                }
                let mut buf = vec![0u8; CHUNK];
                match file.read(&mut buf) {
                    Ok(0) => None,
                    Ok(n) => {
                        buf.truncate(n);
                        let sent = sent + n as u64;
                        if let Some(expected) = &expected {
                            hasher.update(&buf);
                            if !upload_bytes_match(&hasher, sent, total, expected) {
                                changed.store(true, Ordering::SeqCst);
                                let err = std::io::Error::other(FILE_CHANGED);
                                return Some((Err(err), (file, sent, last, true, hasher)));
                            }
                        }
                        let last = if last.elapsed().as_millis() >= 250 || sent == total {
                            let _ = app.emit("vault://upload-progress", UploadProgress { upload_id: id, sent, total });
                            Instant::now()
                        } else {
                            last
                        };
                        Some((Ok::<Vec<u8>, std::io::Error>(buf), (file, sent, last, false, hasher)))
                    }
                    Err(e) => Some((Err(e), (file, sent, last, true, hasher))),
                }
            }
        },
    );

    let resp = state
        .http
        .put(url)
        .header(reqwest::header::CONTENT_LENGTH, total)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(reqwest::Body::wrap_stream(body))
        .send()
        .await;
    if changed.load(Ordering::SeqCst) {
        bail!(FILE_CHANGED);
    }
    let resp = resp.context("upload failed")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        bail!("upload rejected ({status}): {}", text.chars().take(300).collect::<String>());
    }
    Ok(())
}

/// Whether an upload's bytes so far still fit the file it was added as: false once
/// more than `total` bytes arrive, or when the complete file doesn't hash to `expected`.
fn upload_bytes_match(hasher: &blake3::Hasher, sent: u64, total: u64, expected: &str) -> bool {
    if sent > total {
        return false;
    }
    sent < total || hasher.finalize().to_hex().as_str() == expected
}

/// The cached copy of a vault track, if present (bumps its LRU recency).
pub fn cached(app: &AppHandle, content_hash: &str) -> Result<Option<String>> {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("db lock");
    Ok(cache::resolve_cached(&conn, &cache_key(content_hash))?)
}

/// After an upload's commit: copies the uploaded file into this device's cache
/// (`pin`: the downloads tier) so the first play doesn't download it again.
/// Holds the track's download lock, so a play started meanwhile waits for the
/// copy instead of writing the same file.
pub async fn adopt_upload(app: &AppHandle, source: &Path, content_hash: &str, ext: &str, pin: bool) -> Result<bool> {
    if !cache::valid_file_parts(content_hash, ext) {
        bail!("invalid content hash or extension");
    }
    let state = app.state::<VaultState>();
    let key = cache_key(content_hash);
    let lock = {
        let mut locks = state.download_locks.lock().await;
        locks.entry(key.clone()).or_default().clone()
    };
    let _guard = lock.lock().await;
    let paths = app.state::<AppPaths>();
    let dir = if pin { paths.downloads_dir() } else { paths.audio_cache_dir.clone() };
    let db = Db(app.state::<Db>().0.clone());
    let (source, hash, ext) = (source.to_path_buf(), content_hash.to_string(), ext.to_string());
    let adopted = tauri::async_runtime::spawn_blocking(move || cache::adopt_upload(&db, &source, &hash, &ext, &dir, pin))
        .await
        .map_err(|e| anyhow!(e.to_string()))?;
    {
        let mut locks = state.download_locks.lock().await;
        if locks.get(&key).is_some_and(|l| Arc::strong_count(l) <= 2) {
            locks.remove(&key);
        }
    }
    Ok(adopted?)
}

/// Message of a folder change asked for while downloads run; shown as is.
pub const BUSY_DOWNLOADING: &str = "Wait for the downloads to finish, then change the folder.";

/// Points pinned downloads at `dir` and moves the existing ones there with
/// `vault://downloads-move-progress` events. New downloads go to `dir` from
/// the start, so none lands in the old folder while the move runs. The
/// current folder again retries the files an earlier move left behind.
pub async fn move_downloads(app: &AppHandle, dir: PathBuf) -> Result<cache::MoveReport> {
    let state = app.state::<VaultState>();
    let paths = app.state::<AppPaths>();
    if !dir.is_absolute() {
        bail!("choose a folder on this PC");
    }
    let data_dir = paths.default_downloads_dir.parent().map(Path::to_path_buf).unwrap_or_default();
    if dir != paths.default_downloads_dir && dir.starts_with(&data_dir) {
        bail!("choose a folder outside the app's own data folder");
    }
    let mirror = super::mirror::active_dir(&app.state::<Db>().0.lock().expect("db lock"));
    if mirror.is_some_and(|m| dir.starts_with(&m) || m.starts_with(&dir)) {
        bail!(super::mirror::OVERLAPS_MIRROR);
    }
    if state.moving.swap(true, Ordering::SeqCst) {
        bail!("the downloads are already moving");
    }
    let result = async {
        if !state.download_locks.lock().await.is_empty() {
            bail!(BUSY_DOWNLOADING);
        }
        std::fs::create_dir_all(&dir).with_context(|| format!("can't use {}", dir.display()))?;
        let db = Db(app.state::<Db>().0.clone());
        {
            let conn = db.0.lock().expect("db lock");
            let value = if dir == paths.default_downloads_dir { String::new() } else { dir.to_string_lossy().to_string() };
            queries::set_setting(&conn, cache::SETTING_DOWNLOADS_DIR, &value)?;
        }
        *paths.downloads_dir.write().expect("paths lock") = dir.clone();
        let emit_app = app.clone();
        let report = tauri::async_runtime::spawn_blocking(move || {
            let mut last = Instant::now();
            cache::move_pinned(&db, &dir, |p| {
                if p.done == p.total || last.elapsed().as_millis() >= 100 {
                    last = Instant::now();
                    let _ = emit_app.emit("vault://downloads-move-progress", p.clone());
                }
            })
        })
        .await
        .map_err(|e| anyhow!(e.to_string()))??;
        Ok(report)
    }
    .await;
    state.moving.store(false, Ordering::SeqCst);
    result
}

/// Ensures a vault track is on disk, downloading it from `url` if needed.
/// `pin` selects the tier. The bytes are verified against `content_hash`
/// (BLAKE3) — the hash is the track's identity, so a mismatch is never kept.
pub async fn download(app: &AppHandle, content_hash: &str, ext: &str, url: &str, pin: bool) -> Result<String> {
    let state = app.state::<VaultState>();
    let key = cache_key(content_hash);

    let lock = {
        let mut locks = state.download_locks.lock().await;
        locks.entry(key.clone()).or_default().clone()
    };
    let _guard = lock.lock().await;
    let result = download_inner(app, &state, &key, content_hash, ext, url, pin).await;
    state.cancelled.lock().expect("cancel lock").remove(&key);
    {
        let mut locks = state.download_locks.lock().await;
        if let Some(l) = locks.get(&key) {
            if Arc::strong_count(l) <= 2 {
                locks.remove(&key);
            }
        }
    }
    if let Err(e) = &result {
        let _ = app.emit("vault://download-error", DownloadError { file_id: key, message: e.to_string() });
    }
    result
}

async fn download_inner(
    app: &AppHandle,
    state: &VaultState,
    key: &str,
    content_hash: &str,
    ext: &str,
    url: &str,
    pin: bool,
) -> Result<String> {
    let db = app.state::<Db>();
    let paths = app.state::<AppPaths>();

    {
        let conn = db.0.lock().expect("db lock");
        if let Some(path) = cache::resolve_cached(&conn, key)? {
            if !pin {
                return Ok(path);
            }
            let entry = queries::get_cache_entry(&conn, key)?.ok_or_else(|| anyhow!("cache entry vanished"))?;
            if entry.pinned {
                return Ok(path);
            }
            return Ok(cache::promote_to_pinned(&conn, key, &path, &paths.downloads_dir())?);
        }
    }

    let dir = if pin { paths.downloads_dir() } else { paths.audio_cache_dir.clone() };
    let target = dir.join(format!("{content_hash}.{ext}"));
    let temp = target.with_extension(format!("{ext}.part"));

    let resp = state.http.get(url).send().await.context("download failed")?;
    if !resp.status().is_success() {
        bail!("download rejected ({})", resp.status());
    }
    let total = resp.content_length().map(|n| n as i64).unwrap_or(0);
    let mut last_emit = Instant::now();
    let downloaded = stream_verified(resp, &temp, content_hash, |downloaded| {
        if state.cancelled.lock().expect("cancel lock").contains(key) {
            bail!(CANCELLED);
        }
        if last_emit.elapsed().as_millis() >= 250 {
            last_emit = Instant::now();
            let _ = app.emit("vault://download-progress", DownloadProgress { file_id: key.to_string(), downloaded, total });
        }
        Ok(())
    })
    .await?;
    if let Err(e) = std::fs::rename(&temp, &target) {
        let _ = std::fs::remove_file(&temp);
        return Err(e).context("can't finalize download");
    }
    {
        let conn = db.0.lock().expect("db lock");
        cache::register_download(&conn, key, &target, downloaded, pin)?;
    }
    let path = target.to_string_lossy().to_string();
    let _ = app.emit(
        "vault://download-progress",
        DownloadProgress { file_id: key.to_string(), downloaded, total: downloaded },
    );
    let _ = app.emit("vault://download-done", DownloadDone { file_id: key.to_string(), path: path.clone(), pinned: pin });
    Ok(path)
}

/// Writes a download to `temp`, hashing it on the way, and returns its size
/// once it matches `content_hash`. `on_chunk` gets the bytes so far after each
/// chunk and stops the download with an error. On any failure `temp` is
/// removed: nothing indexes it, so nothing would ever clean it up.
async fn stream_verified(
    resp: reqwest::Response,
    temp: &Path,
    content_hash: &str,
    mut on_chunk: impl FnMut(i64) -> Result<()>,
) -> Result<i64> {
    let mut file = std::fs::File::create(temp).context("can't create download file")?;
    let streamed: Result<(i64, String)> = async {
        let mut hasher = blake3::Hasher::new();
        let mut downloaded: i64 = 0;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("download stream failed")?;
            hasher.update(&chunk);
            file.write_all(&chunk)?;
            downloaded += chunk.len() as i64;
            on_chunk(downloaded)?;
        }
        file.flush()?;
        Ok((downloaded, hasher.finalize().to_hex().to_string()))
    }
    .await;
    drop(file);
    match streamed {
        Ok((downloaded, actual)) if actual == content_hash => Ok(downloaded),
        Ok(_) => {
            let _ = std::fs::remove_file(temp);
            bail!("downloaded bytes don't match the track's content hash");
        }
        Err(e) => {
            let _ = std::fs::remove_file(temp);
            Err(e)
        }
    }
}

/// Downloads a vault track to `temp` outside the cache (the library mirror),
/// verified against its content hash like any download.
pub async fn fetch_verified(app: &AppHandle, url: &str, temp: &Path, content_hash: &str) -> Result<i64> {
    let state = app.state::<VaultState>();
    let resp = state.http.get(url).send().await.context("download failed")?;
    if !resp.status().is_success() {
        bail!("download rejected ({})", resp.status());
    }
    stream_verified(resp, temp, content_hash, |_| Ok(())).await
}

/// Downloads a cover image into the artwork cache as `file_name` unless it is
/// already there. Covers are content-addressed, so an existing file is current.
pub async fn fetch_art(app: &AppHandle, url: &str, file_name: &str) -> Result<String> {
    if file_name.contains(['/', '\\']) || file_name.contains("..") {
        bail!("invalid artwork file name");
    }
    let paths = app.state::<AppPaths>();
    let target = paths.artwork_dir.join(file_name);
    if target.exists() {
        return Ok(file_name.to_string());
    }
    let state = app.state::<VaultState>();
    let resp = state.http.get(url).send().await.context("cover download failed")?;
    if !resp.status().is_success() {
        bail!("cover download rejected ({})", resp.status());
    }
    let bytes = resp.bytes().await?;
    std::fs::create_dir_all(&paths.artwork_dir)?;
    let temp = target.with_extension("part");
    std::fs::write(&temp, &bytes)?;
    std::fs::rename(&temp, &target)?;
    Ok(file_name.to_string())
}

/// Whether a file name is one of ours left by an interrupted transfer
/// (`<hash>.<ext>.part`). The download folder may be one the owner also uses
/// for other things, so other `.part` files are never touched.
fn is_our_partial(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".part") else { return false };
    let Some((hash, ext)) = stem.split_once('.') else { return false };
    cache::valid_file_parts(hash, ext)
}

/** Deletes leftover `.part` files of interrupted downloads. Returns how many went. */
pub fn remove_stale_partials(dirs: &[&std::path::Path]) -> usize {
    let mut removed = 0;
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let ours = path.file_name().is_some_and(|n| is_our_partial(&n.to_string_lossy()));
            if ours && std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    if removed > 0 {
        tracing::info!(removed, "removed partial downloads left by an earlier run");
    }
    removed
}

#[cfg(test)]
mod partial_tests {
    use super::remove_stale_partials;

    #[test]
    fn removes_only_our_partial_files() {
        let dir = std::env::temp_dir().join(format!("mv-partials-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ours = format!("{}.flac.part", "a".repeat(64));
        std::fs::write(dir.join(&ours), b"half").unwrap();
        std::fs::write(dir.join(format!("{}.flac", "b".repeat(64))), b"whole").unwrap();
        // Someone else's download in a shared folder.
        std::fs::write(dir.join("setup.exe.part"), b"theirs").unwrap();
        assert_eq!(remove_stale_partials(&[&dir]), 1);
        assert!(!dir.join(&ours).exists());
        assert!(dir.join("setup.exe.part").exists());
        assert!(dir.join(format!("{}.flac", "b".repeat(64))).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod upload_check_tests {
    use super::upload_bytes_match;

    fn hashed(chunks: &[&[u8]]) -> blake3::Hasher {
        let mut h = blake3::Hasher::new();
        for c in chunks {
            h.update(c);
        }
        h
    }

    #[test]
    fn the_file_it_was_added_as_passes() {
        let expected = blake3::hash(b"hello world").to_hex().to_string();
        assert!(upload_bytes_match(&hashed(&[b"hello ", b"world"]), 11, 11, &expected));
    }

    #[test]
    fn a_resaved_file_of_the_same_size_fails_at_the_end() {
        let expected = blake3::hash(b"hello world").to_hex().to_string();
        let resaved = hashed(&[b"hello ", b"WORLD"]);
        assert!(upload_bytes_match(&hashed(&[b"hello "]), 6, 11, &expected), "can't judge mid-file");
        assert!(!upload_bytes_match(&resaved, 11, 11, &expected));
    }

    #[test]
    fn a_file_that_grew_fails() {
        let expected = blake3::hash(b"hello").to_hex().to_string();
        assert!(!upload_bytes_match(&hashed(&[b"hello!"]), 6, 5, &expected));
    }
}
