use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const MINI_W: f64 = 400.0;
const MINI_H: f64 = 132.0;

/// Toggles the always-on-top mini player: opens it (hiding the main window)
/// or closes it (the Destroyed handler in lib.rs restores the main window).
///
/// Must stay `async`: a synchronous command runs on the main thread, and
/// building a webview window there deadlocks on Windows (the app froze).
#[tauri::command]
pub async fn mini_toggle(app: AppHandle) -> Result<(), String> {
    if let Some(mini) = app.get_webview_window("mini") {
        mini.close().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(&app, "mini", WebviewUrl::App("index.html".into()))
        .title("Music Vault Mini")
        .inner_size(MINI_W, MINI_H)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .always_on_top(true);

    // Default to the top-right corner of the primary monitor.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let pos = monitor.position().to_logical::<f64>(scale);
        builder = builder.position(pos.x + size.width - MINI_W - 16.0, pos.y + 16.0);
    }

    builder.build().map_err(|e| e.to_string())?;

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(())
}

/// Brings the main window back (mini player closed, second app launch, …).
pub fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}
