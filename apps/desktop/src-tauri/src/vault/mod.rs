//! The vault: audio and covers in the owner's private R2 bucket
//! (docs/drive-to-r2-migration.md). The frontend talks to the `vault` Edge
//! Function for short-lived pre-signed URLs; this module does the parts that
//! need the file system and raw bandwidth:
//!
//! - [`prepare`]: hash a picked file (BLAKE3 identity + MD5 for linking old
//!   Drive rows), read its tags and technical properties, and turn embedded or
//!   picked art into the vault's square JPEG cover + thumbnail.
//! - [`cache`]: the two-tier cache of vault audio on this device.
//! - [`transfer`]: stream uploads to and downloads from pre-signed URLs with
//!   progress events, verifying every download against its content hash.
//! - [`mirror`]: keep a folder of plain, tagged music files in step with the
//!   vault, with [`retag`] writing the details into each copy.

pub mod cache;
pub mod mirror;
pub mod prepare;
pub mod retag;
pub mod transfer;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Shared vault transfer state managed by Tauri.
pub struct VaultState {
    pub http: reqwest::Client,
    /// Per-track download locks: a second caller for the same content hash
    /// waits for the in-flight download instead of starting another.
    pub download_locks: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Cache keys whose in-flight download should stop at the next chunk.
    pub cancelled: std::sync::Mutex<HashSet<String>>,
    /// Set while pinned downloads move to a new folder, so two moves can't overlap.
    pub moving: std::sync::atomic::AtomicBool,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            download_locks: tokio::sync::Mutex::new(HashMap::new()),
            cancelled: std::sync::Mutex::new(HashSet::new()),
            moving: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

/// Cache-index key for a vault track (`cache_entries.file_id`).
pub fn cache_key(content_hash: &str) -> String {
    format!("vault:{content_hash}")
}
