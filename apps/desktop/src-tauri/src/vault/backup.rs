//! Backup Music Vault: one folder on this PC holding what it takes to rebuild
//! the library without Supabase or R2.
//!
//! - `Music/`: every song as a tagged file ([`super::mirror`]).
//! - `Covers/<sha256>.jpg`: every cover at full size, named as in the vault.
//! - `Artist photos/<artist>.jpg`: the photos picked for artists.
//! - `Database/<table>.json`: the account's rows from the sync shadow, written
//!   by the frontend, which owns the shadow's shape.
//! - `Backup info.json`: when the backup last finished and what it holds.
//!
//! The frontend drives a run, as for the music; these commands only write
//! inside the backup folder.

use std::path::{Component, Path, PathBuf};

use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;

use super::mirror::{self, UNAVAILABLE};
use crate::commands::AppPaths;

/// Top-level entries the frontend may write; `Music` belongs to the mirror.
const WRITABLE: [&str; 4] = ["Database", "Covers", "Artist photos", "Backup info.json"];

/// The backup folder, which must exist (a missing one is an unplugged drive).
fn root(conn: &Connection) -> Result<PathBuf> {
    let dir = mirror::active_dir(conn).ok_or_else(|| anyhow!("backups are off"))?;
    if !dir.is_dir() {
        bail!(UNAVAILABLE);
    }
    Ok(dir)
}

/// A `/`-separated path from the frontend, checked to stay inside the backup
/// folder and under one of [`WRITABLE`].
fn resolve(root: &Path, rel_path: &str) -> Result<PathBuf> {
    let rel = Path::new(rel_path);
    let normal = !rel_path.is_empty() && rel.components().all(|c| matches!(c, Component::Normal(_)));
    let top = rel.components().next().and_then(|c| c.as_os_str().to_str());
    if !normal || !top.is_some_and(|t| WRITABLE.contains(&t)) {
        bail!("invalid backup path");
    }
    Ok(root.join(rel))
}

/// Writes through a temporary file, so an interrupted run never leaves half a file.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part = target.with_extension("part");
    std::fs::write(&part, bytes)?;
    std::fs::rename(&part, target)?;
    Ok(())
}

/// Writes a text file (database export, backup info) into the backup folder.
pub fn write_text(conn: &Connection, rel_path: &str, contents: &str) -> Result<()> {
    let target = resolve(&root(conn)?, rel_path)?;
    write_atomic(&target, contents.as_bytes())
}

/// Copies a cover from the artwork cache into the backup folder unless an
/// identical-size copy is already there. Returns whether it copied.
pub fn copy_art(conn: &Connection, paths: &AppPaths, file_name: &str, rel_path: &str) -> Result<bool> {
    let valid = file_name
        .strip_prefix("vault-")
        .and_then(|n| n.strip_suffix(".jpg"))
        .is_some_and(|sha| sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()));
    if !valid {
        bail!("invalid artwork file name");
    }
    let source = paths.artwork_dir.join(file_name);
    let target = resolve(&root(conn)?, rel_path)?;
    let size = std::fs::metadata(&source)?.len();
    if std::fs::metadata(&target).is_ok_and(|m| m.len() == size) {
        return Ok(false);
    }
    write_atomic(&target, &std::fs::read(&source)?)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_writable_folders() {
        let root = Path::new("C:/Backup");
        assert!(resolve(root, "Database/tracks.json").is_ok());
        assert!(resolve(root, "Covers/abc.jpg").is_ok());
        assert!(resolve(root, "Artist photos/Mira Sol.jpg").is_ok());
        assert!(resolve(root, "Backup info.json").is_ok());
        assert!(resolve(root, "Music/A/B.mp3").is_err(), "the songs are the mirror's");
        assert!(resolve(root, "Database/../../x").is_err());
        assert!(resolve(root, "").is_err());
        assert!(resolve(root, "Other/x.json").is_err());
    }
}
