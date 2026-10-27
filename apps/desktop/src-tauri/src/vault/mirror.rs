//! The music half of Backup Music Vault ([`super::backup`]): the backup
//! folder's `Music` folder kept as plain music files, one per vault track, each carrying the track's current online details and cover
//! ([`super::retag`]) under `Artist/Album/Title.ext`, with synced lyrics as a
//! `.lrc` beside it. Any player can use the folder without the app.
//!
//! It is one-way: the vault is the source, and a run only writes what changed
//! since the last one (`mirror_entries`). The frontend drives a run: it
//! sends every live track to [`plan`], signs links for the songs this PC has
//! no copy of, then calls [`apply`] per song and [`remove`] for deleted ones.
//!
//! Songs deleted from the vault are moved to `Removed from vault`, never
//! deleted. Only a tombstone removes a song, never its absence from a list,
//! so a library that hasn't loaded yet can't empty the folder.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::retag::{self, Retag, TagValues};
use super::{cache, cache_key, transfer};
use crate::commands::AppPaths;
use crate::db::models::MirrorEntryRow;
use crate::db::{queries, Db};

/// The backup folder while backups are on. Kept in this device's database only.
/// Builds before 2026-10-27 kept a bare music mirror under "mirror_dir"; that
/// folder is left as it is, and a backup starts in a folder the owner picks.
pub const SETTING_MIRROR_DIR: &str = "backup_dir";
/// The backup folder's subfolder the songs go in.
pub const MUSIC_DIR: &str = "Music";
/// The folder `mirror_entries` describes. It outlives turning the mirror off,
/// so turning it on again with the same folder carries on where it stopped.
const SETTING_ENTRIES_DIR: &str = "mirror_entries_dir";
/// The account `mirror_entries` belongs to.
const SETTING_ENTRIES_ACCOUNT: &str = "mirror_entries_account";

pub const REMOVED_DIR: &str = "Removed from vault";
/// Work files of a run, inside the mirror folder so the final rename stays on one drive.
const TEMP_DIR: &str = ".musicvault-temp";
/// Changes whenever what [`apply`] writes changes, so every file is redone once.
const WRITE_FORMAT: &str = "mirror-v1";
const MAX_NAME_CHARS: usize = 100;

pub const OVERLAPS_MIRROR: &str = "That folder overlaps the backup folder. Choose a separate one.";
pub const UNAVAILABLE: &str = "The backup folder can't be found. Plug in its drive, or choose the folder again.";

/// One live vault track as the mirror writes it.
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MirrorTrack {
    /// The track row's id: stays the same through edits.
    pub id: String,
    pub content_hash: String,
    /// The vault object's extension.
    pub ext: String,
    pub file_size: i64,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: Option<String>,
    pub language: Option<String>,
    pub country: Option<String>,
    pub release_date: Option<String>,
    pub lyrics_text: Option<String>,
    /// Synced lyrics as LRC text, written beside the song.
    pub lrc: Option<String>,
    pub replay_gain_track: Option<f64>,
    pub replay_gain_album: Option<f64>,
    /// The full-size cover's vault key.
    pub artwork_key: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MirrorWork {
    pub id: String,
    pub rel_path: String,
    /// No copy on this PC or in the mirror: the frontend signs a link for it.
    pub needs_audio: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MirrorPlan {
    pub work: Vec<MirrorWork>,
    /// Tracks deleted from the vault that still have a file in the mirror.
    pub removed: Vec<String>,
    pub up_to_date: usize,
    /// Of the songs that need a new file.
    pub bytes_needed: i64,
    pub free_bytes: Option<i64>,
    /// Songs written without their details (a format that can't be tagged).
    pub untagged: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub tagged: bool,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn setting(conn: &Connection, key: &str) -> Option<String> {
    queries::get_setting(conn, key).ok().flatten().filter(|s| !s.is_empty())
}

/// The backup folder, while backups are on.
pub fn active_dir(conn: &Connection) -> Option<PathBuf> {
    setting(conn, SETTING_MIRROR_DIR).map(PathBuf::from)
}

fn overlaps(a: &Path, b: &Path) -> bool {
    a.starts_with(b) || b.starts_with(a)
}

/// Turns the mirror on with `dir`, or off with `None`. The files stay either
/// way. A folder other than the one the entries describe starts from scratch.
pub fn set_dir(conn: &Connection, paths: &AppPaths, dir: Option<PathBuf>) -> Result<()> {
    let Some(dir) = dir else {
        queries::set_setting(conn, SETTING_MIRROR_DIR, "")?;
        return Ok(());
    };
    if !dir.is_absolute() {
        bail!("choose a folder on this PC");
    }
    let data_dir = paths.default_downloads_dir.parent().map(Path::to_path_buf).unwrap_or_default();
    if overlaps(&dir, &data_dir) {
        bail!("choose a folder outside the app's own data folder");
    }
    if overlaps(&dir, &paths.downloads_dir()) {
        bail!("choose a folder apart from the download folder");
    }
    std::fs::create_dir_all(&dir).with_context(|| format!("can't use {}", dir.display()))?;
    let value = dir.to_string_lossy().to_string();
    if setting(conn, SETTING_ENTRIES_DIR).as_deref() != Some(value.as_str()) {
        queries::clear_mirror_entries(conn)?;
        queries::set_setting(conn, SETTING_ENTRIES_DIR, &value)?;
    }
    queries::set_setting(conn, SETTING_MIRROR_DIR, &value)?;
    Ok(())
}

/// What a file was written from: the details plus whether the cover was there,
/// so a song written before its cover arrived is redone once it has it.
fn digest(track: &MirrorTrack, has_cover: bool) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(WRITE_FORMAT.as_bytes());
    hasher.update(&serde_json::to_vec(track).unwrap_or_default());
    hasher.update(&[has_cover as u8]);
    hasher.finalize().to_hex().to_string()
}

/// Players don't know `.alac`; it is an MP4 file.
fn mirror_ext(ext: &str) -> String {
    match ext.to_ascii_lowercase().as_str() {
        "alac" => "m4a".into(),
        other => other.into(),
    }
}

/// A file or folder name Windows accepts, from a title, artist or album.
fn safe_name(raw: &str, fallback: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '_' } else { c })
        .collect();
    let mut name: String = replaced.trim().chars().take(MAX_NAME_CHARS).collect();
    // Windows drops trailing dots and spaces, which would merge names.
    name = name.trim_end_matches(['.', ' ']).trim_start().to_string();
    if name.is_empty() {
        return fallback.to_string();
    }
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0');
    if reserved {
        name.push('_');
    }
    name
}

/// `Artist/Album/Title`, without the extension.
fn base_stem(track: &MirrorTrack) -> String {
    format!(
        "{}/{}/{}",
        safe_name(&track.artist, "Unknown Artist"),
        safe_name(&track.album, "Unknown Album"),
        safe_name(&track.title, "Untitled"),
    )
}

fn stem_of(rel_path: &str) -> &str {
    match rel_path.rfind('.') {
        Some(dot) if !rel_path[dot..].contains('/') => &rel_path[..dot],
        _ => rel_path,
    }
}

/// Whether `stem` is `base` or `base (n)`.
fn is_numbered(stem: &str, base: &str) -> bool {
    stem.eq_ignore_ascii_case(base)
        || (stem.len() > base.len()
            && stem[..base.len()].eq_ignore_ascii_case(base)
            && stem[base.len()..].strip_prefix(" (").and_then(|n| n.strip_suffix(')')).is_some_and(|n| n.parse::<u32>().is_ok()))
}

/// Gives each track its path in the mirror. A track keeps the path it has
/// while it still fits its details, so " (2)" never moves between songs; new
/// paths go in track-id order. Paths are compared without case or extension
/// (Windows ignores case, and a `.lrc` is shared by any extension).
/// `taken_on_disk` says whether a file the mirror didn't write is in the way.
fn assign_paths(
    tracks: &[MirrorTrack],
    existing: &HashMap<String, MirrorEntryRow>,
    taken_on_disk: impl Fn(&str) -> bool,
) -> HashMap<String, String> {
    let mut taken: HashSet<String> = existing.values().map(|e| stem_of(&e.rel_path).to_lowercase()).collect();
    let mut kept: HashSet<String> = HashSet::new();
    let mut out = HashMap::new();
    let mut fresh: Vec<&MirrorTrack> = Vec::new();
    for track in tracks {
        let ext = mirror_ext(&track.ext);
        match existing.get(&track.id) {
            Some(entry)
                if is_numbered(stem_of(&entry.rel_path), &base_stem(track))
                    && kept.insert(stem_of(&entry.rel_path).to_lowercase()) =>
            {
                out.insert(track.id.clone(), format!("{}.{ext}", stem_of(&entry.rel_path)));
            }
            _ => fresh.push(track),
        }
    }
    fresh.sort_by(|a, b| a.id.cmp(&b.id));
    for track in fresh {
        let base = base_stem(track);
        let ext = mirror_ext(&track.ext);
        let mut n = 1;
        let stem = loop {
            let candidate = if n == 1 { base.clone() } else { format!("{base} ({n})") };
            let key = candidate.to_lowercase();
            if !taken.contains(&key) && !taken_on_disk(&format!("{candidate}.{ext}")) {
                break candidate;
            }
            n += 1;
        };
        taken.insert(stem.to_lowercase());
        out.insert(track.id.clone(), format!("{stem}.{ext}"));
    }
    out
}

/// A `/`-separated path from the frontend, checked to stay inside the mirror.
fn resolve(dir: &Path, rel_path: &str) -> Result<PathBuf> {
    let rel = Path::new(rel_path);
    if rel_path.is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        bail!("invalid mirror path");
    }
    Ok(dir.join(rel))
}

fn cover_path(paths: &AppPaths, artwork_key: Option<&str>) -> Option<PathBuf> {
    let key = artwork_key?;
    let sha = key.strip_suffix(".jpg")?.rsplit('/').next()?;
    (sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| paths.artwork_dir.join(format!("vault-{sha}.jpg")))
        .filter(|p| p.exists())
}

/// This PC's cached or downloaded copy of a track, without touching its recency.
fn cached_copy(conn: &Connection, content_hash: &str) -> Option<PathBuf> {
    let entry = queries::get_cache_entry(conn, &cache_key(content_hash)).ok()??;
    Some(PathBuf::from(entry.path)).filter(|p| p.exists())
}

/// The backup folder's `Music` folder, made on first use. The backup folder
/// itself must be there: a missing one is an unplugged drive, not a folder to make.
fn ready_dir(conn: &Connection) -> Result<PathBuf> {
    let root = active_dir(conn).ok_or_else(|| anyhow!("backups are off"))?;
    if !root.is_dir() {
        bail!(UNAVAILABLE);
    }
    let dir = root.join(MUSIC_DIR);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[cfg(windows)]
fn free_bytes(dir: &Path) -> Option<i64> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free = 0u64;
    unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut free as *mut u64), None, None) }.ok()?;
    i64::try_from(free).ok()
}

#[cfg(not(windows))]
fn free_bytes(_dir: &Path) -> Option<i64> {
    None
}

/// The work folder, emptied: a run that was cut off leaves nothing behind.
fn fresh_temp_dir(dir: &Path) -> Result<PathBuf> {
    let temp = dir.join(TEMP_DIR);
    if temp.exists() {
        for entry in std::fs::read_dir(&temp)?.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    std::fs::create_dir_all(&temp)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
        let wide: Vec<u16> = temp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let _ = unsafe { SetFileAttributesW(PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_HIDDEN) };
    }
    Ok(temp)
}

/// Works out what a run has to do. Entries belonging to another account are
/// forgotten first (their files stay).
pub fn plan(db: &Db, paths: &AppPaths, account: &str, tracks: &[MirrorTrack], tombstoned: &[String]) -> Result<MirrorPlan> {
    let conn = db.0.lock().expect("db lock");
    let dir = ready_dir(&conn)?;
    if setting(&conn, SETTING_ENTRIES_ACCOUNT).as_deref() != Some(account) {
        queries::clear_mirror_entries(&conn)?;
        queries::set_setting(&conn, SETTING_ENTRIES_ACCOUNT, account)?;
    }
    fresh_temp_dir(&dir)?;
    let existing: HashMap<String, MirrorEntryRow> =
        queries::list_mirror_entries(&conn)?.into_iter().map(|e| (e.track_id.clone(), e)).collect();
    let assigned = assign_paths(tracks, &existing, |rel| dir.join(rel).exists());

    let mut plan = MirrorPlan {
        work: Vec::new(),
        removed: Vec::new(),
        up_to_date: 0,
        bytes_needed: 0,
        free_bytes: free_bytes(&dir),
        untagged: existing.values().filter(|e| !e.tagged).count(),
    };
    for track in tracks {
        let rel_path = assigned[&track.id].clone();
        let entry = existing.get(&track.id);
        let file_ok = entry.is_some_and(|e| e.content_hash == track.content_hash && dir.join(&e.rel_path).exists());
        let has_cover = cover_path(paths, track.artwork_key.as_deref()).is_some();
        let current = file_ok && entry.is_some_and(|e| e.rel_path == rel_path && e.digest == digest(track, has_cover));
        if current {
            plan.up_to_date += 1;
            continue;
        }
        if !file_ok {
            plan.bytes_needed += track.file_size;
        }
        plan.work.push(MirrorWork {
            id: track.id.clone(),
            rel_path,
            needs_audio: !file_ok && cached_copy(&conn, &track.content_hash).is_none(),
        });
    }
    plan.removed = tombstoned.iter().filter(|id| existing.contains_key(*id)).cloned().collect();
    Ok(plan)
}

fn tag_values<'a>(track: &'a MirrorTrack, cover: Option<Vec<u8>>) -> TagValues<'a> {
    TagValues {
        title: &track.title,
        artist: &track.artist,
        album: &track.album,
        genre: track.genre.as_deref(),
        language: track.language.as_deref(),
        country: track.country.as_deref(),
        release_date: track.release_date.as_deref(),
        lyrics: track.lyrics_text.as_deref(),
        replay_gain_track: track.replay_gain_track,
        replay_gain_album: track.replay_gain_album,
        content_hash: &track.content_hash,
        cover,
    }
}

/// Tags a copy of `source` and returns the copy, or `source` itself when the
/// format can't be tagged or tagging failed (which may spoil the copy).
fn tagged_copy(source: &Path, ext: &str, values: &TagValues) -> Result<(PathBuf, bool)> {
    let copy = source.with_extension("tagging");
    std::fs::copy(source, &copy)?;
    match retag::write_tags(&copy, ext, values) {
        Ok(Retag::Tagged) => Ok((copy, true)),
        Ok(Retag::Skipped(reason)) => {
            tracing::info!(file = %source.display(), reason, "mirror copy left untagged");
            let _ = std::fs::remove_file(&copy);
            Ok((source.to_path_buf(), false))
        }
        Err(e) => {
            tracing::warn!(file = %source.display(), error = %e, "couldn't tag a mirror copy");
            let _ = std::fs::remove_file(&copy);
            Ok((source.to_path_buf(), false))
        }
    }
}

/// Removes the empty folders above `file`, up to the mirror folder.
fn prune_empty(dir: &Path, file: &Path) {
    let mut current = file.parent();
    while let Some(folder) = current {
        if folder == dir || !folder.starts_with(dir) || std::fs::remove_dir(folder).is_err() {
            break;
        }
        current = folder.parent();
    }
}

fn lrc_of(path: &Path) -> PathBuf {
    path.with_extension("lrc")
}

/// Brings one track's file up to date: writes it if the mirror has none,
/// moves it when its path changed, and rewrites its tags when its details did.
/// The file is replaced in one rename, so a player never sees half of it.
pub async fn apply(app: &AppHandle, track: MirrorTrack, rel_path: String, audio_url: Option<String>) -> Result<ApplyOutcome> {
    if !cache::valid_file_parts(&track.content_hash, &track.ext) {
        bail!("invalid content hash or extension");
    }
    let db = Db(app.state::<Db>().0.clone());
    let (dir, entry, cached) = {
        let conn = db.0.lock().expect("db lock");
        (ready_dir(&conn)?, queries::get_mirror_entry(&conn, &track.id)?, cached_copy(&conn, &track.content_hash))
    };
    let target = resolve(&dir, &rel_path)?;
    let old = match &entry {
        Some(e) if e.content_hash == track.content_hash => Some(resolve(&dir, &e.rel_path)?).filter(|p| p.exists()),
        _ => None,
    };
    let temp_dir = dir.join(TEMP_DIR);
    std::fs::create_dir_all(&temp_dir)?;
    let source = temp_dir.join(format!("{}.{}.part", track.content_hash, track.ext));

    // A new file needs the audio: from this PC's copy, else from the vault.
    let downloaded = if old.is_none() && cached.is_none() {
        let url = audio_url.ok_or_else(|| anyhow!("no link to download this song"))?;
        transfer::fetch_verified(app, &url, &source, &track.content_hash).await?;
        true
    } else {
        false
    };

    let paths_cover = cover_path(&app.state::<AppPaths>(), track.artwork_key.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        let cover = paths_cover.as_ref().and_then(|p| std::fs::read(p).ok());
        let has_cover = cover.is_some();
        let new_digest = digest(&track, has_cover);
        let ext = mirror_ext(&track.ext);
        let values = tag_values(&track, cover);
        let result = (|| -> Result<bool> {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut tagged = entry.as_ref().is_some_and(|e| e.tagged);
            match &old {
                Some(old_path) => {
                    if *old_path != target {
                        if target.exists() && !old_path.to_string_lossy().eq_ignore_ascii_case(&target.to_string_lossy()) {
                            bail!("another file is already at {rel_path}");
                        }
                        std::fs::rename(old_path, &target)?;
                        let old_lrc = lrc_of(old_path);
                        if old_lrc.exists() {
                            let _ = std::fs::rename(&old_lrc, lrc_of(&target));
                        }
                        prune_empty(&dir, old_path);
                    }
                    if entry.as_ref().is_some_and(|e| e.digest != new_digest) {
                        std::fs::copy(&target, &source)?;
                        let (written, ok) = tagged_copy(&source, &ext, &values)?;
                        tagged = ok;
                        if ok {
                            std::fs::rename(&written, &target)?;
                        }
                    }
                }
                None => {
                    if !downloaded {
                        let from = cached.as_ref().expect("checked above");
                        if cache::copy_verified(from, &source, &track.content_hash, &mut |_| {})?.is_none() {
                            bail!("this PC's copy doesn't match the song's content hash");
                        }
                    }
                    let (written, ok) = tagged_copy(&source, &ext, &values)?;
                    tagged = ok;
                    std::fs::rename(&written, &target)?;
                }
            }
            let lrc = lrc_of(&target);
            match &track.lrc {
                Some(text) if std::fs::read_to_string(&lrc).ok().as_deref() != Some(text.as_str()) => std::fs::write(&lrc, text)?,
                Some(_) => {}
                None if entry.as_ref().is_some_and(|e| e.has_lrc) && lrc.exists() => std::fs::remove_file(&lrc)?,
                None => {}
            }
            Ok(tagged)
        })();
        let _ = std::fs::remove_file(&source);
        let tagged = result?;
        let conn = db.0.lock().expect("db lock");
        queries::upsert_mirror_entry(
            &conn,
            &MirrorEntryRow {
                track_id: track.id.clone(),
                content_hash: track.content_hash.clone(),
                rel_path: rel_path.clone(),
                digest: new_digest,
                has_lrc: track.lrc.is_some(),
                tagged,
                written_at: now_ms(),
            },
        )?;
        Ok(ApplyOutcome { tagged })
    })
    .await
    .map_err(|e| anyhow!(e.to_string()))?
}

/// `path`, or `path (2)`, `path (3)`… whichever is free.
fn free_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|n| path.with_file_name(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("some number is free")
}

/// Moves the files of tracks deleted from the vault into `Removed from vault`,
/// keeping their paths. A file in use stays and is tried again next run.
/// Returns how many moved.
pub fn remove(db: &Db, track_ids: &[String]) -> Result<usize> {
    let conn = db.0.lock().expect("db lock");
    let dir = ready_dir(&conn)?;
    let mut moved = 0;
    for id in track_ids {
        let Some(entry) = queries::get_mirror_entry(&conn, id)? else { continue };
        let from = resolve(&dir, &entry.rel_path)?;
        if from.exists() {
            let to = free_path(&dir.join(REMOVED_DIR).join(&entry.rel_path));
            let moved_file = to.parent().map(std::fs::create_dir_all).transpose().and_then(|_| std::fs::rename(&from, &to));
            if let Err(e) = moved_file {
                tracing::warn!(file = %from.display(), error = %e, "couldn't move a removed song out of the mirror");
                continue;
            }
            let lrc = lrc_of(&from);
            if lrc.exists() {
                let _ = std::fs::rename(&lrc, lrc_of(&to));
            }
            prune_empty(&dir, &from);
            moved += 1;
        }
        queries::delete_mirror_entry(&conn, id)?;
    }
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, artist: &str, album: &str, title: &str, ext: &str) -> MirrorTrack {
        MirrorTrack {
            id: id.into(),
            content_hash: "a".repeat(64),
            ext: ext.into(),
            file_size: 10,
            title: title.into(),
            artist: artist.into(),
            album: album.into(),
            genre: None,
            language: None,
            country: None,
            release_date: None,
            lyrics_text: None,
            lrc: None,
            replay_gain_track: None,
            replay_gain_album: None,
            artwork_key: None,
        }
    }

    fn entry(id: &str, rel_path: &str) -> MirrorEntryRow {
        MirrorEntryRow {
            track_id: id.into(),
            content_hash: "a".repeat(64),
            rel_path: rel_path.into(),
            digest: String::new(),
            has_lrc: false,
            tagged: true,
            written_at: 0,
        }
    }

    #[test]
    fn names_are_safe_on_windows() {
        assert_eq!(safe_name("AC/DC", "x"), "AC_DC");
        assert_eq!(safe_name("What? Why: *now*", "x"), "What_ Why_ _now_");
        assert_eq!(safe_name("  Trailing dots...  ", "x"), "Trailing dots");
        assert_eq!(safe_name("   ", "Unknown Artist"), "Unknown Artist");
        assert_eq!(safe_name("con", "x"), "con_");
        assert_eq!(safe_name("COM1.live", "x"), "COM1.live_");
        assert_eq!(safe_name("COM0", "x"), "COM0");
        assert_eq!(safe_name("Concerto", "x"), "Concerto");
        assert_eq!(safe_name("আমার সোনার বাংলা", "x"), "আমার সোনার বাংলা");
        assert_eq!(safe_name(&"y".repeat(300), "x").chars().count(), MAX_NAME_CHARS);
    }

    #[test]
    fn same_named_songs_are_numbered_and_keep_their_numbers() {
        let a = track("a", "Artist", "Album", "Song", "flac");
        let b = track("b", "Artist", "Album", "song", "mp3");
        let first = assign_paths(&[a.clone(), b.clone()], &HashMap::new(), |_| false);
        assert_eq!(first["a"], "Artist/Album/Song.flac");
        assert_eq!(first["b"], "Artist/Album/song (2).mp3");

        // "b" keeps (2) even when listed first next time.
        let existing = HashMap::from([("a".into(), entry("a", &first["a"])), ("b".into(), entry("b", &first["b"]))]);
        let again = assign_paths(&[b, a], &existing, |_| false);
        assert_eq!(again, first);
    }

    #[test]
    fn an_edited_title_gets_a_new_path_and_alac_becomes_m4a() {
        let existing = HashMap::from([("a".into(), entry("a", "Artist/Album/Old.m4a"))]);
        let paths = assign_paths(&[track("a", "Artist", "Album", "New", "alac")], &existing, |_| false);
        assert_eq!(paths["a"], "Artist/Album/New.m4a");
    }

    #[test]
    fn a_file_the_mirror_didnt_write_is_never_taken() {
        let paths = assign_paths(&[track("a", "A", "B", "C", "mp3")], &HashMap::new(), |rel| rel == "A/B/C.mp3");
        assert_eq!(paths["a"], "A/B/C (2).mp3");
    }

    #[test]
    fn numbered_stems_are_recognised() {
        assert!(is_numbered("A/B/Song (3)", "A/B/Song"));
        assert!(is_numbered("a/b/song", "A/B/Song"));
        assert!(!is_numbered("A/B/Song (live)", "A/B/Song"));
        assert!(!is_numbered("A/B/Songs", "A/B/Song"));
    }

    #[test]
    fn paths_from_the_frontend_stay_inside_the_mirror() {
        let dir = Path::new("D:\\Mirror");
        assert!(resolve(dir, "A/B/C.mp3").is_ok());
        assert!(resolve(dir, "../C.mp3").is_err());
        assert!(resolve(dir, "C:\\Windows\\x.mp3").is_err());
        assert!(resolve(dir, "").is_err());
    }

    #[test]
    fn the_digest_follows_details_and_the_cover() {
        let a = track("a", "A", "B", "C", "mp3");
        let mut edited = a.clone();
        edited.genre = Some("Jazz".into());
        assert_ne!(digest(&a, false), digest(&edited, false));
        assert_ne!(digest(&a, false), digest(&a, true));
        assert_eq!(digest(&a, true), digest(&a.clone(), true));
    }

    #[test]
    fn removing_moves_files_and_keeps_paths() {
        let root = std::env::temp_dir().join(format!("mv-mirror-remove-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join(MUSIC_DIR);
        std::fs::create_dir_all(dir.join("A/B")).unwrap();
        std::fs::write(dir.join("A/B/C.mp3"), b"song").unwrap();
        std::fs::write(dir.join("A/B/C.lrc"), b"[00:01.00]hi").unwrap();
        let db = crate::db::open(&root.join("t.db")).unwrap();
        {
            let conn = db.0.lock().unwrap();
            queries::set_setting(&conn, SETTING_MIRROR_DIR, &root.to_string_lossy()).unwrap();
            queries::upsert_mirror_entry(&conn, &entry("a", "A/B/C.mp3")).unwrap();
        }
        assert_eq!(remove(&db, &["a".into(), "unknown".into()]).unwrap(), 1);
        assert_eq!(std::fs::read(dir.join(REMOVED_DIR).join("A/B/C.mp3")).unwrap(), b"song");
        assert!(dir.join(REMOVED_DIR).join("A/B/C.lrc").exists());
        assert!(!dir.join("A").exists(), "empty folders go");
        assert!(queries::get_mirror_entry(&db.0.lock().unwrap(), "a").unwrap().is_none());
        drop(db);
        let _ = std::fs::remove_dir_all(&root);
    }
}
