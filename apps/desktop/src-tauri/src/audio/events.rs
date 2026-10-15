use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PositionEvent {
    pub position: f64,
    pub duration: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StateEvent {
    pub playing: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedEvent {
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEvent {
    pub sample_rate: u32,
    pub device_name: String,
    pub resampling: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumEvent {
    pub freq: Vec<u8>,
    pub wave: Vec<u8>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

pub fn emit_position(app: &AppHandle, position: f64, duration: f64) {
    let _ = app.emit("player://position", PositionEvent { position, duration });
}

pub fn emit_state(app: &AppHandle, playing: bool) {
    let _ = app.emit("player://state", StateEvent { playing });
}

pub fn emit_ended(app: &AppHandle) {
    let _ = app.emit("player://ended", ());
}

pub fn emit_advanced(app: &AppHandle, path: &str) {
    let _ = app.emit("player://advanced", AdvancedEvent { path: path.to_string() });
}

pub fn emit_device(app: &AppHandle, sample_rate: u32, device_name: &str, resampling: bool) {
    let _ = app.emit(
        "player://device",
        DeviceEvent {
            sample_rate,
            device_name: device_name.to_string(),
            resampling,
        },
    );
}

pub fn emit_spectrum(app: &AppHandle, freq: Vec<u8>, wave: Vec<u8>) {
    let _ = app.emit("player://spectrum", SpectrumEvent { freq, wave });
}

pub fn emit_error(app: &AppHandle, message: &str, path: Option<&str>) {
    tracing::error!(message, ?path, "player error");
    let _ = app.emit(
        "player://error",
        ErrorEvent {
            message: message.to_string(),
            path: path.map(|p| p.to_string()),
        },
    );
}
