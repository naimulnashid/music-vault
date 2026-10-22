use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistRow {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub track_ids: Vec<String>,
    pub is_smart: bool,
    /// JSON-serialized SmartRules (see @musicvault/core smartRules.ts); rows stay opaque to Rust.
    pub smart_rules: Option<String>,
}

/// A downloaded Drive file in the two-tier cache (auto vs pinned).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntryRow {
    pub file_id: String,
    pub path: String,
    pub size: i64,
    pub pinned: bool,
    pub last_access: i64,
    pub created_at: i64,
}

/// A track written to the library mirror folder.
#[derive(Clone, Debug, PartialEq)]
pub struct MirrorEntryRow {
    pub track_id: String,
    pub content_hash: String,
    /// Relative to the mirror folder, `/`-separated.
    pub rel_path: String,
    /// Of the details the file was written with ([`crate::vault::mirror`]).
    pub digest: String,
    pub has_lrc: bool,
    /// False when the file was copied without the details (an untaggable format).
    pub tagged: bool,
    pub written_at: i64,
}

/// A pending sync op waiting to be flushed to Supabase.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutboxRow {
    pub id: String,
    /// ISO-8601 client timestamp (ordering key).
    pub created_at: String,
    /// Full SyncOp envelope JSON (see docs/sync-protocol.md).
    pub payload: String,
    pub attempts: i64,
}

/// One mirrored remote row in the sync shadow.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncShadowRow {
    pub id: String,
    pub payload: String,
}

/// One locally recorded play event (Phase 7 statistics source).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayEventLocalRow {
    /// Client-generated UUID, shared with the playEvent.add sync op.
    pub id: String,
    /// Local library track id (may be "drive:<fileId>").
    pub track_id: String,
    /// Session start, epoch ms.
    pub played_at: i64,
    /// Seconds actually listened.
    pub duration_played: f64,
    pub completed: bool,
}
