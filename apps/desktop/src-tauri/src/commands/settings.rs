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
