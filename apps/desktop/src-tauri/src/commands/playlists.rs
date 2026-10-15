use tauri::State;

use crate::db::models::PlaylistRow;
use crate::db::{queries, Db};

#[tauri::command]
pub fn playlists_get_all(db: State<'_, Db>) -> Result<Vec<PlaylistRow>, String> {
    let conn = db.0.lock().expect("db lock");
    queries::get_all_playlists(&conn).map_err(String::from)
}

#[tauri::command]
pub fn playlists_create(
    db: State<'_, Db>,
    id: String,
    name: String,
    created_at: i64,
    smart_rules: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::create_playlist(&conn, &id, &name, created_at, smart_rules.as_deref())
        .map_err(String::from)
}

#[tauri::command]
pub fn playlists_set_rules(db: State<'_, Db>, id: String, smart_rules: String) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::set_playlist_rules(&conn, &id, &smart_rules).map_err(String::from)
}

#[tauri::command]
pub fn playlists_rename(db: State<'_, Db>, id: String, name: String) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::rename_playlist(&conn, &id, &name).map_err(String::from)
}

#[tauri::command]
pub fn playlists_delete(db: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::delete_playlist(&conn, &id).map_err(String::from)
}

#[tauri::command]
pub fn playlists_set_tracks(db: State<'_, Db>, id: String, track_ids: Vec<String>) -> Result<(), String> {
    let mut conn = db.0.lock().expect("db lock");
    queries::set_playlist_tracks(&mut conn, &id, &track_ids).map_err(String::from)
}
