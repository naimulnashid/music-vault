use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::commands::AppPaths;
use crate::db::models::CacheEntryRow;
use crate::db::{queries, Db};
use crate::vault::cache::{self, CacheStats};
use crate::vault::{prepare, transfer};

/// Where prepared covers wait for upload: inside the artwork dir, so the
/// upload form can preview them through the (artwork-scoped) asset protocol.
pub const STAGING_SUBDIR: &str = "upload-staging";

fn staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.state::<AppPaths>().artwork_dir.join(STAGING_SUBDIR))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    pub path: String,
    pub file: Option<prepare::PreparedFile>,
    pub error: Option<String>,
}

/// Hashes, tag-reads and cover-prepares each picked file (off the UI thread).
/// Folders are walked for supported audio files. One result per file, in
/// order; a file that can't be prepared carries an error instead.
#[tauri::command]
pub async fn vault_prepare_files(app: AppHandle, paths: Vec<String>) -> Result<Vec<PrepareResult>, String> {
    let staging = staging_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut files: Vec<PathBuf> = Vec::new();
        for p in paths {
            let path = PathBuf::from(&p);
            if path.is_dir() {
                for entry in walkdir::WalkDir::new(&path).into_iter().flatten() {
                    if entry.file_type().is_file() && prepare::audio_ext(entry.path()).is_some() {
                        files.push(entry.into_path());
                    }
                }
            } else {
                files.push(path);
            }
        }
        files
            .into_iter()
            .map(|path| match prepare::prepare_file(&path, &staging) {
                Ok(file) => PrepareResult { path: path.to_string_lossy().to_string(), file: Some(file), error: None },
                Err(e) => PrepareResult { path: path.to_string_lossy().to_string(), file: None, error: Some(e.to_string()) },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Turns a picked image into the vault's cover format (square JPEG + thumb).
#[tauri::command]
pub async fn vault_prepare_cover(app: AppHandle, path: String) -> Result<prepare::PreparedCover, String> {
    let staging = staging_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("can't read {path}: {e}"))?;
        prepare::prepare_cover(&bytes, &staging).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Streams a file to a pre-signed PUT URL with `vault://upload-progress` events.
#[tauri::command]
pub async fn vault_put_file(
    app: AppHandle,
    url: String,
    path: String,
    upload_id: String,
    content_type: String,
    expected_blake3: Option<String>,
) -> Result<(), String> {
    transfer::put_file(&app, &url, &PathBuf::from(path), &upload_id, &content_type, expected_blake3.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// The cached copy of a vault track, if this device has one.
#[tauri::command]
pub fn vault_cached(app: AppHandle, content_hash: String) -> Result<Option<String>, String> {
    transfer::cached(&app, &content_hash).map_err(|e| e.to_string())
}

/// Downloads a vault track (verified against its hash) into the cache tier.
#[tauri::command]
pub async fn vault_download(
    app: AppHandle,
    content_hash: String,
    ext: String,
    url: String,
    pin: bool,
) -> Result<String, String> {
    transfer::download(&app, &content_hash, &ext, &url, pin).await.map_err(|e| e.to_string())
}

/// Downloads a cover into the artwork cache (no-op when already there).
#[tauri::command]
pub async fn vault_fetch_art(app: AppHandle, url: String, file_name: String) -> Result<String, String> {
    transfer::fetch_art(&app, &url, &file_name).await.map_err(|e| e.to_string())
}

/// Copies a just-uploaded cover (full + thumb) from staging into the artwork
/// cache under its vault name, so it shows without downloading it back.
#[tauri::command]
pub fn vault_adopt_art(app: AppHandle, sha256: String, full_path: String, thumb_path: String) -> Result<String, String> {
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid cover hash".into());
    }
    let paths = app.state::<AppPaths>();
    std::fs::create_dir_all(&paths.artwork_dir).map_err(|e| e.to_string())?;
    let file_name = format!("vault-{sha256}.jpg");
    std::fs::copy(&full_path, paths.artwork_dir.join(&file_name)).map_err(|e| e.to_string())?;
    let _ = std::fs::copy(&thumb_path, paths.artwork_dir.join(format!("vault-{sha256}.thumb.jpg")));
    Ok(file_name)
}

/// Drops this device's copies of tracks deleted from the vault.
#[tauri::command]
pub fn vault_forget_deleted(app: AppHandle, content_hashes: Vec<String>) -> Result<usize, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("db lock");
    cache::forget_deleted(&conn, &content_hashes).map_err(|e| e.to_string())
}

/// Every cached and pinned track on this device.
#[tauri::command]
pub fn vault_downloads_list(app: AppHandle) -> Result<Vec<CacheEntryRow>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("db lock");
    queries::list_cache_entries(&conn).map_err(String::from)
}

/// Removes a download / cached file from disk and the index.
#[tauri::command]
pub fn vault_download_remove(app: AppHandle, file_id: String) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("db lock");
    cache::remove(&conn, &file_id).map_err(String::from)
}

#[tauri::command]
pub fn vault_cache_stats(app: AppHandle) -> Result<CacheStats, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("db lock");
    cache::stats(&conn).map_err(String::from)
}

/// Stops in-flight downloads of these cache keys (`vault:<hash>`).
#[tauri::command]
pub async fn vault_download_cancel(app: AppHandle, file_ids: Vec<String>) -> Result<(), String> {
    transfer::cancel(&app, &file_ids).await;
    Ok(())
}

/// Empties the auto-cache (pinned downloads stay).
#[tauri::command]
pub fn vault_cache_clear(app: AppHandle) -> Result<CacheStats, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("db lock");
    cache::clear_auto(&conn).map_err(String::from)?;
    cache::stats(&conn).map_err(String::from)
}

/// Sets the auto-cache size cap in bytes (0 = off, at most 10 GiB) and
/// evicts down to it immediately.
#[tauri::command]
pub fn vault_cache_set_max(app: AppHandle, max_bytes: i64) -> Result<CacheStats, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("db lock");
    let max_bytes = max_bytes.clamp(0, cache::MAX_CACHE_MAX);
    queries::set_setting(&conn, cache::SETTING_CACHE_MAX, &max_bytes.to_string()).map_err(String::from)?;
    cache::enforce_cap(&conn).map_err(String::from)?;
    cache::stats(&conn).map_err(String::from)
}
