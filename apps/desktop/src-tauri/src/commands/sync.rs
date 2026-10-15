use tauri::State;

use crate::db::models::{SyncOutboxRow, SyncShadowRow};
use crate::db::{queries, Db};

/// Persistence for the TypeScript sync engine (packages/core/src/sync): the
/// outbox, pull cursors and remote-row shadow live in SQLite so queued
/// mutations survive crashes. All logic stays in TS; these are dumb stores.

#[tauri::command]
pub fn sync_outbox_all(db: State<'_, Db>) -> Result<Vec<SyncOutboxRow>, String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_outbox_all(&conn).map_err(String::from)
}

#[tauri::command]
pub fn sync_outbox_put(
    db: State<'_, Db>,
    id: String,
    created_at: String,
    payload: String,
) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_outbox_put(&conn, &id, &created_at, &payload).map_err(String::from)
}

#[tauri::command]
pub fn sync_outbox_delete(db: State<'_, Db>, ids: Vec<String>) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_outbox_delete(&conn, &ids).map_err(String::from)
}

#[tauri::command]
pub fn sync_outbox_bump(db: State<'_, Db>, ids: Vec<String>) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_outbox_bump(&conn, &ids).map_err(String::from)
}

#[tauri::command]
pub fn sync_cursor_get(db: State<'_, Db>, name: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_cursor_get(&conn, &name).map_err(String::from)
}

#[tauri::command]
pub fn sync_cursor_set(db: State<'_, Db>, name: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_cursor_set(&conn, &name, &value).map_err(String::from)
}

#[tauri::command]
pub fn sync_shadow_get(db: State<'_, Db>, entity: String, id: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_shadow_get(&conn, &entity, &id).map_err(String::from)
}

#[tauri::command]
pub fn sync_shadow_put(
    db: State<'_, Db>,
    entity: String,
    id: String,
    payload: String,
) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_shadow_put(&conn, &entity, &id, &payload).map_err(String::from)
}

#[tauri::command]
pub fn sync_shadow_delete(db: State<'_, Db>, entity: String, id: String) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_shadow_delete(&conn, &entity, &id).map_err(String::from)
}

#[tauri::command]
pub fn sync_shadow_all(db: State<'_, Db>, entity: String) -> Result<Vec<SyncShadowRow>, String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_shadow_all(&conn, &entity).map_err(String::from)
}

#[tauri::command]
pub fn sync_clear_all(db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().expect("db lock");
    queries::sync_clear_all(&conn).map_err(String::from)
}

/// Sync-engine breadcrumbs from the frontend land in the same rotating
/// appdata log as the Rust side, so one file tells the whole sync story.
#[tauri::command]
pub fn sync_breadcrumb(event: String, detail: Option<String>) {
    match detail {
        Some(detail) => tracing::info!(target: "sync", %event, %detail, "breadcrumb"),
        None => tracing::info!(target: "sync", %event, "breadcrumb"),
    }
}
