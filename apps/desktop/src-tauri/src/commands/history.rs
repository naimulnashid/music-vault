use tauri::State;

use crate::db::models::PlayEventLocalRow;
use crate::db::{queries, Db};

/// The local play-event log (Phase 7). Statistics on the frontend merge these
/// rows with the synced play_events shadow, deduping on the shared event id.

#[tauri::command]
pub fn play_event_add(
    db: State<'_, Db>,
    id: String,
    track_id: String,
    played_at: i64,
    duration_played: f64,
    completed: bool,
) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::play_event_add(&conn, &id, &track_id, played_at, duration_played, completed)
        .map_err(String::from)
}

#[tauri::command]
pub fn play_events_all(db: State<'_, Db>) -> Result<Vec<PlayEventLocalRow>, String> {
    let conn = db.0.lock().expect("db lock");
    queries::play_events_all(&conn).map_err(String::from)
}
