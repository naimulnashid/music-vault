use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::commands::window::show_main;

/// System tray handles kept alive (dropping a TrayIcon removes it) so the
/// playback commands can update the menu/tooltip as state changes.
pub struct TrayState {
    pub icon: TrayIcon,
    pub play_pause: MenuItem<Wry>,
}

#[derive(Serialize, Clone)]
struct ControlEvent {
    action: &'static str,
}

/// Sends a transport action through the same channel the SMTC bridge uses —
/// the main window already knows how to dispatch these onto the player store.
pub fn emit_control(app: &AppHandle, action: &'static str) {
    let _ = app.emit("smtc://control", ControlEvent { action });
}

/// Focus whichever window is the user-facing one right now.
fn focus_active_window(app: &AppHandle) {
    if let Some(mini) = app.get_webview_window("mini") {
        let _ = mini.set_focus();
    } else {
        show_main(app);
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Music Vault", true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "play_pause", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next track", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Previous track", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &play_pause,
            &next,
            &prev,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = TrayIconBuilder::with_id("main")
        .icon(
            app.default_window_icon()
                .expect("bundled window icon")
                .clone(),
        )
        .tooltip("Music Vault")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_active_window(app),
            "play_pause" => emit_control(app, "toggle"),
            "next" => emit_control(app, "next"),
            "prev" => emit_control(app, "prev"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_active_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayState { icon, play_pause });
    tracing::info!("system tray attached");
    Ok(())
}

/// Playback state changed: flip the menu label.
pub fn update_playback(app: &AppHandle, playing: bool) {
    if let Some(tray) = app.try_state::<TrayState>() {
        let _ = tray.play_pause.set_text(if playing { "Pause" } else { "Play" });
    }
}

/// Track changed: show it in the tray tooltip.
pub fn update_track(app: &AppHandle, title: &str, artist: &str) {
    if let Some(tray) = app.try_state::<TrayState>() {
        let _ = tray.icon.set_tooltip(Some(format!("{title} — {artist}")));
    }
}

/// First time the window is closed to the tray, say so — otherwise closing
/// looks like quitting while the music keeps playing. Shown once per install.
pub fn hint_still_running(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let marker = dir.join("tray-hint-shown");
    if marker.exists() {
        return;
    }
    let _ = std::fs::write(&marker, b"1");
    let _ = app
        .notification()
        .builder()
        .title("Music Vault is still running")
        .body("It keeps playing in the system tray. Right-click the tray icon and choose Quit to exit.")
        .show();
}
