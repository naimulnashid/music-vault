mod audio;
mod commands;
mod db;
mod error;
#[cfg(windows)]
mod jumplist;
mod scan;
mod smtc;
mod tray;
mod vault;

use tauri::Manager;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Jump list task: forward the transport action, don't steal focus.
            #[cfg(windows)]
            if let Some(action) = jumplist::control_arg(&argv) {
                let action: &'static str = match action {
                    "toggle" => "toggle",
                    "next" => "next",
                    "prev" => "prev",
                    _ => return,
                };
                tray::emit_control(app, action);
                return;
            }
            let _ = &argv;
            // Second launch: surface whichever window is active — the mini
            // player if open (the main window is hidden then), else main.
            if let Some(mini) = app.get_webview_window("mini") {
                let _ = mini.set_focus();
            } else {
                // The main window may be hidden in the tray.
                commands::window::show_main(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            // File logging with daily rotation under <app-data>/logs.
            let file_appender = tracing_appender::rolling::daily(data_dir.join("logs"), "music-vault.log");
            let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
            tracing_subscriber::registry()
                .with(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "info,music_vault_lib=debug".into()),
                )
                .with(
                    tracing_subscriber::fmt::layer()
                        .with_writer(file_writer)
                        .with_ansi(false),
                )
                .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
                .init();
            // Keep the appender guard alive for the app's lifetime.
            app.manage(guard);

            tracing::info!(version = env!("CARGO_PKG_VERSION"), "Music Vault starting");
            let setup_started = std::time::Instant::now();

            let db = db::open(&data_dir.join("library.db"))?;
            let db_ms = setup_started.elapsed().as_millis() as u64;
            let custom_downloads = vault::cache::custom_downloads_dir(&db.0.lock().expect("db lock"));
            app.manage(db);

            let default_downloads_dir = data_dir.join("downloads");
            std::fs::create_dir_all(&default_downloads_dir)?;
            // A picked folder on a drive that isn't plugged in: new downloads go to
            // the default for this run; the setting stays for when it is back.
            let downloads_dir = match custom_downloads {
                Some(dir) if std::fs::create_dir_all(&dir).is_ok() => dir,
                Some(dir) => {
                    tracing::warn!(dir = %dir.display(), "download folder unavailable, using the default");
                    default_downloads_dir.clone()
                }
                None => default_downloads_dir.clone(),
            };
            let paths = commands::AppPaths {
                artwork_dir: data_dir.join("artwork"),
                audio_cache_dir: data_dir.join("audio-cache"),
                downloads_dir: std::sync::RwLock::new(downloads_dir.clone()),
                default_downloads_dir: default_downloads_dir.clone(),
            };
            std::fs::create_dir_all(&paths.audio_cache_dir)?;
            // No transfer runs before setup finishes, so any .part here was cut
            // off by a crash or kill and is unreachable; clear it.
            vault::transfer::remove_stale_partials(&[&paths.audio_cache_dir, &default_downloads_dir, &downloads_dir]);
            app.manage(paths);

            let engine_started = std::time::Instant::now();
            let engine = audio::spawn_engine(app.handle().clone());
            let engine_ms = engine_started.elapsed().as_millis() as u64;
            app.manage(engine);

            app.manage(vault::VaultState::new());

            match smtc::init(app.handle()) {
                Ok(smtc) => {
                    app.manage(smtc);
                }
                Err(e) => {
                    // Media keys are non-essential; run without them.
                    tracing::warn!(error = %e, "SMTC unavailable");
                    app.manage(smtc::Smtc(std::sync::Mutex::new(None)));
                }
            }

            if let Err(e) = tray::init(app.handle()) {
                // The app is fully usable without a tray icon.
                tracing::warn!(error = %e, "tray unavailable");
            }

            #[cfg(windows)]
            if let Err(e) = jumplist::install() {
                tracing::warn!(error = %e, "jump list unavailable");
            }

            // Startup profile: how long the blocking part of setup took and
            // where. Watch this line when startup feels slow.
            tracing::info!(
                total_ms = setup_started.elapsed().as_millis() as u64,
                db_ms,
                engine_ms,
                "setup done"
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::player::player_load,
            commands::player::player_play,
            commands::player::player_pause,
            commands::player::player_stop,
            commands::player::player_seek,
            commands::player::player_set_volume,
            commands::player::player_set_eq,
            commands::player::player_set_crossfade,
            commands::player::player_set_gapless,
            commands::player::player_preload_next,
            commands::player::player_set_rg,
            commands::player::player_set_visualizer,
            commands::playlists::playlists_get_all,
            commands::playlists::playlists_create,
            commands::playlists::playlists_rename,
            commands::playlists::playlists_delete,
            commands::playlists::playlists_set_tracks,
            commands::playlists::playlists_set_rules,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::sync::sync_outbox_all,
            commands::sync::sync_outbox_put,
            commands::sync::sync_outbox_delete,
            commands::sync::sync_outbox_bump,
            commands::sync::sync_cursor_get,
            commands::sync::sync_cursor_set,
            commands::sync::sync_shadow_get,
            commands::sync::sync_shadow_put,
            commands::sync::sync_shadow_delete,
            commands::sync::sync_shadow_all,
            commands::sync::sync_clear_all,
            commands::sync::sync_breadcrumb,
            commands::history::play_event_add,
            commands::history::play_events_all,
            commands::vault::vault_prepare_files,
            commands::vault::vault_prepare_cover,
            commands::vault::vault_put_file,
            commands::vault::vault_cached,
            commands::vault::vault_download,
            commands::vault::vault_fetch_art,
            commands::vault::vault_adopt_art,
            commands::vault::vault_forget_deleted,
            commands::vault::vault_downloads_list,
            commands::vault::vault_download_remove,
            commands::vault::vault_cache_stats,
            commands::vault::vault_cache_set_max,
            commands::vault::vault_cache_clear,
            commands::vault::vault_download_cancel,
            commands::vault::vault_adopt_upload,
            commands::vault::vault_downloads_dir,
            commands::vault::vault_downloads_move,
            commands::vault::vault_mirror_dir,
            commands::vault::vault_mirror_set_dir,
            commands::vault::vault_mirror_plan,
            commands::vault::vault_mirror_apply,
            commands::vault::vault_mirror_remove,
            commands::smtc_update,
            commands::smtc_playback,
            commands::window::mini_toggle,
        ])
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the main window keeps the app (and the music) running
            // in the tray; tray → Quit is the way out.
            ("main", tauri::WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
                tray::hint_still_running(window.app_handle());
            }
            // However the mini player goes away (expand button, Alt+F4), the
            // main window must come back — it is hidden while mini is open.
            ("mini", tauri::WindowEvent::Destroyed) => commands::window::show_main(window.app_handle()),
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building Music Vault")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Stop the mixer thread cleanly so WASAPI shuts down quietly.
                app.state::<audio::EngineHandle>().send(audio::Cmd::Shutdown);
                tracing::info!("Music Vault exiting");
            }
        });
}
