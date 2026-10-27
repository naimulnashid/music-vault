use tauri::State;

use crate::db::{queries, Db};

#[tauri::command]
pub fn settings_get(db: State<'_, Db>) -> Result<Option<String>, String> {
    let conn = db.0.lock().expect("db lock");
    queries::get_setting(&conn, "settings").map_err(String::from)
}

#[tauri::command]
pub fn settings_set(db: State<'_, Db>, json: String) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::set_setting(&conn, "settings", &json).map_err(String::from)
}

/// This PC's name, so statistics and the device list can tell machines apart.
#[tauri::command]
pub fn device_name() -> Option<String> {
    std::env::var("COMPUTERNAME").ok().map(|n| n.trim().to_string()).filter(|n| !n.is_empty())
}
