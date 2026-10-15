pub mod history;
pub mod player;
pub mod playlists;
pub mod settings;
pub mod sync;
pub mod vault;
pub mod window;

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::smtc::{self, Smtc};
use crate::tray;

/// Well-known app directories resolved once at startup.
pub struct AppPaths {
    pub artwork_dir: PathBuf,
    /// Auto-cache tier: filled by playing a track; LRU-evicted.
    pub audio_cache_dir: PathBuf,
    /// Pinned tier: explicit downloads; never auto-evicted.
    pub downloads_dir: PathBuf,
}

#[tauri::command]
pub fn smtc_update(
    app: AppHandle,
    smtc: State<'_, Smtc>,
    title: String,
    artist: String,
    album: String,
    artwork_path: Option<String>,
    duration: f64,
) -> Result<(), String> {
    tray::update_track(&app, &title, &artist);
    smtc::update_metadata(&smtc, &title, &artist, &album, artwork_path.as_deref(), duration)
        .map_err(String::from)
}

#[tauri::command]
pub fn smtc_playback(
    app: AppHandle,
    smtc: State<'_, Smtc>,
    playing: bool,
    position: f64,
) -> Result<(), String> {
    tray::update_playback(&app, playing);
    smtc::update_playback(&smtc, playing, position).map_err(String::from)
}
