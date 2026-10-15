use tauri::State;

use crate::audio::{Cmd, EngineHandle};

#[tauri::command]
pub fn player_load(
    engine: State<'_, EngineHandle>,
    path: String,
    start_at: f64,
    autoplay: bool,
    rg_db: Option<f64>,
) {
    engine.send(Cmd::Load { path, start_at, autoplay, rg_db });
}

#[tauri::command]
pub fn player_play(engine: State<'_, EngineHandle>) {
    engine.send(Cmd::Play);
}

#[tauri::command]
pub fn player_pause(engine: State<'_, EngineHandle>) {
    engine.send(Cmd::Pause);
}

#[tauri::command]
pub fn player_stop(engine: State<'_, EngineHandle>) {
    engine.send(Cmd::Stop);
}

#[tauri::command]
pub fn player_seek(engine: State<'_, EngineHandle>, position: f64) {
    engine.send(Cmd::Seek(position));
}

#[tauri::command]
pub fn player_set_volume(engine: State<'_, EngineHandle>, volume: f32) {
    engine.send(Cmd::SetVolume(volume));
}

#[tauri::command]
pub fn player_set_eq(engine: State<'_, EngineHandle>, bands: Vec<f32>) -> Result<(), String> {
    let bands: [f32; 10] = bands
        .try_into()
        .map_err(|_| "expected exactly 10 EQ bands".to_string())?;
    engine.send(Cmd::SetEq(bands));
    Ok(())
}

#[tauri::command]
pub fn player_set_crossfade(engine: State<'_, EngineHandle>, seconds: f32) {
    engine.send(Cmd::SetCrossfade(seconds));
}

#[tauri::command]
pub fn player_set_gapless(engine: State<'_, EngineHandle>, enabled: bool) {
    engine.send(Cmd::SetGapless(enabled));
}

#[tauri::command]
pub fn player_preload_next(
    engine: State<'_, EngineHandle>,
    path: Option<String>,
    rg_db: Option<f64>,
) {
    engine.send(Cmd::PreloadNext { path, rg_db });
}

#[tauri::command]
pub fn player_set_rg(engine: State<'_, EngineHandle>, rg_db: Option<f64>) {
    engine.send(Cmd::SetRgGain(rg_db));
}

#[tauri::command]
pub fn player_set_visualizer(engine: State<'_, EngineHandle>, enabled: bool) {
    engine.send(Cmd::SetVisualizer(enabled));
}
