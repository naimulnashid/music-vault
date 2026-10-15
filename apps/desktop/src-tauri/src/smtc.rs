use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};

/// Windows System Media Transport Controls bridge (media keys, volume flyout).
/// Metadata/playback pushes come from the frontend via commands; hardware
/// control events are forwarded back as `smtc://control`.
pub struct Smtc(pub Mutex<Option<MediaControls>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ControlEvent {
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<f64>,
}

pub fn init(app: &AppHandle) -> AppResult<Smtc> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Other("main window not found".into()))?;
    let hwnd = window
        .hwnd()
        .map_err(|e| AppError::Other(format!("failed to get window handle: {e}")))?;

    let config = PlatformConfig {
        dbus_name: "music_vault",
        display_name: "Music Vault",
        hwnd: Some(hwnd.0 as *mut std::ffi::c_void),
    };
    let mut controls = MediaControls::new(config)
        .map_err(|e| AppError::Other(format!("failed to create media controls: {e:?}")))?;

    let emitter = app.clone();
    controls
        .attach(move |event| {
            let payload = match event {
                MediaControlEvent::Play => ControlEvent { action: "play", position: None },
                MediaControlEvent::Pause => ControlEvent { action: "pause", position: None },
                MediaControlEvent::Toggle => ControlEvent { action: "toggle", position: None },
                MediaControlEvent::Next => ControlEvent { action: "next", position: None },
                MediaControlEvent::Previous => ControlEvent { action: "prev", position: None },
                MediaControlEvent::SetPosition(MediaPosition(pos)) => ControlEvent {
                    action: "seek",
                    position: Some(pos.as_secs_f64()),
                },
                _ => return,
            };
            let _ = emitter.emit("smtc://control", payload);
        })
        .map_err(|e| AppError::Other(format!("failed to attach media controls: {e:?}")))?;

    tracing::info!("SMTC media controls attached");
    Ok(Smtc(Mutex::new(Some(controls))))
}

pub fn update_metadata(
    smtc: &Smtc,
    title: &str,
    artist: &str,
    album: &str,
    artwork_path: Option<&str>,
    duration: f64,
) -> AppResult<()> {
    let mut guard = smtc.0.lock().expect("smtc lock");
    let Some(controls) = guard.as_mut() else { return Ok(()) };
    let cover_url = artwork_path.map(|p| format!("file:///{}", p.replace('\\', "/")));
    controls
        .set_metadata(MediaMetadata {
            title: Some(title),
            artist: Some(artist),
            album: Some(album),
            cover_url: cover_url.as_deref(),
            duration: (duration > 0.0).then(|| Duration::from_secs_f64(duration)),
        })
        .map_err(|e| AppError::Other(format!("smtc metadata failed: {e:?}")))?;
    Ok(())
}

pub fn update_playback(smtc: &Smtc, playing: bool, position: f64) -> AppResult<()> {
    let mut guard = smtc.0.lock().expect("smtc lock");
    let Some(controls) = guard.as_mut() else { return Ok(()) };
    let progress = Some(MediaPosition(Duration::from_secs_f64(position.max(0.0))));
    let playback = if playing {
        MediaPlayback::Playing { progress }
    } else {
        MediaPlayback::Paused { progress }
    };
    controls
        .set_playback(playback)
        .map_err(|e| AppError::Other(format!("smtc playback failed: {e:?}")))?;
    Ok(())
}
