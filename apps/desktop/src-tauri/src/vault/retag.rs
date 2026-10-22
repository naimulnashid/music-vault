//! Writes a track's online details into a copy of its audio file, for the
//! library mirror ([`super::mirror`]). The vault's own objects are never
//! touched: their bytes are the track's identity.
//!
//! What lofty 0.22 does and doesn't do here was tested on every vault format
//! before this was written (2026-10-22), and shapes the rules below:
//! - Only the *other* tag types a file carries are removed first. Removing an
//!   absent ID3v1 writes an empty one (which hides an APE tag from readers),
//!   and removing an MP4 ilst drops the `meta` atom's `hdlr`, after which
//!   ffmpeg and others ignore the new tags. Saving a tag replaces one of its type.
//! - ID3v2.4, not 2.3: lofty's 2.3 output has a picture description with a
//!   broken byte-order mark that lofty itself and ffmpeg can't read back.
//! - Properties aren't read: lofty rejects some valid ADTS AAC streams there.
//! - Ogg FLAC is detected as MPEG, so a detected type has to fit the extension.
//! - Removing AIFF text chunks panics, so they are left, and any panic is caught.

use std::borrow::Cow;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

use anyhow::{anyhow, Result};
use lofty::ape::{ApeItem, ApeTag};
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::iff::wav::RiffInfoList;
use lofty::id3::v2::Id3v2Tag;
use lofty::mp4::{Atom, AtomData, AtomIdent, Ilst};
use lofty::ogg::VorbisComments;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{Accessor, ItemKey, TagExt};
use lofty::probe::Probe;
use lofty::tag::{ItemValue, Tag, TagType};

/// Custom field holding the vault content hash of the file a mirror copy was
/// made from, so an upload can tell a mirror copy from a new song.
pub const HASH_FIELD: &str = "MUSICVAULT_HASH";
const COUNTRY_FIELD: &str = "COUNTRY";

/// The details written into a mirror copy.
pub struct TagValues<'a> {
    pub title: &'a str,
    pub artist: &'a str,
    pub album: &'a str,
    pub genre: Option<&'a str>,
    pub language: Option<&'a str>,
    pub country: Option<&'a str>,
    pub release_date: Option<&'a str>,
    pub lyrics: Option<&'a str>,
    pub replay_gain_track: Option<f64>,
    pub replay_gain_album: Option<f64>,
    pub content_hash: &'a str,
    /// The vault's full-size square JPEG cover.
    pub cover: Option<Vec<u8>>,
}

#[derive(Debug, PartialEq)]
pub enum Retag {
    Tagged,
    /// Left as it was, for this reason. The file was not touched.
    Skipped(&'static str),
}

const ALL_TAG_TYPES: [TagType; 7] = [
    TagType::Ape,
    TagType::Id3v1,
    TagType::Id3v2,
    TagType::Mp4Ilst,
    TagType::VorbisComments,
    TagType::RiffInfo,
    TagType::AiffText,
];

/// The file types an extension may hold; anything else isn't tagged.
fn fits_extension(ext: &str, file_type: &FileType) -> bool {
    match ext {
        "mp3" => *file_type == FileType::Mpeg,
        "aac" => *file_type == FileType::Aac,
        "wav" => *file_type == FileType::Wav,
        "aiff" | "aif" => *file_type == FileType::Aiff,
        "flac" => *file_type == FileType::Flac,
        "ogg" | "oga" | "opus" => matches!(file_type, FileType::Vorbis | FileType::Opus | FileType::Speex),
        "m4a" | "mp4" | "alac" => *file_type == FileType::Mp4,
        "ape" => *file_type == FileType::Ape,
        "wv" => *file_type == FileType::WavPack,
        _ => false,
    }
}

/// Replaces the tags of the file at `path` with `values`. An error or a panic
/// part-way can leave the file half-written, so callers tag a copy.
pub fn write_tags(path: &Path, ext: &str, values: &TagValues) -> Result<Retag> {
    match catch_unwind(AssertUnwindSafe(|| write_inner(path, ext, values))) {
        Ok(result) => result,
        Err(_) => Err(anyhow!("the tag library failed on this file")),
    }
}

fn write_inner(path: &Path, ext: &str, values: &TagValues) -> Result<Retag> {
    let probe = Probe::open(path)?.options(ParseOptions::new().read_properties(false)).guess_file_type()?;
    let Some(file_type) = probe.file_type() else {
        return Ok(Retag::Skipped("unknown file type"));
    };
    if !fits_extension(ext, &file_type) {
        return Ok(Retag::Skipped("this kind of file can't be tagged"));
    }
    let existing = probe.read()?;
    let target = match file_type {
        FileType::Flac | FileType::Opus | FileType::Vorbis | FileType::Speex => TagType::VorbisComments,
        FileType::Mp4 => TagType::Mp4Ilst,
        FileType::Ape | FileType::WavPack => TagType::Ape,
        _ => TagType::Id3v2,
    };
    for tag_type in ALL_TAG_TYPES {
        let keep = tag_type == target || tag_type == TagType::AiffText || (tag_type == TagType::RiffInfo && file_type == FileType::Wav);
        if !keep && existing.contains_tag_type(tag_type) {
            tag_type.remove_from_path(path)?;
        }
    }
    drop(existing);

    let tag = generic_tag(values);
    let options = WriteOptions::new();
    let customs = [(COUNTRY_FIELD, values.country), (HASH_FIELD, Some(values.content_hash))];
    match target {
        TagType::VorbisComments => {
            let mut vorbis = VorbisComments::from(tag);
            for (key, value) in customs {
                if let Some(value) = value {
                    vorbis.push(key.to_string(), value.to_string());
                }
            }
            vorbis.save_to_path(path, options)?;
        }
        TagType::Mp4Ilst => {
            let mut ilst = Ilst::from(tag);
            for (key, value) in customs {
                if let Some(value) = value {
                    ilst.insert(Atom::new(
                        AtomIdent::Freeform { mean: Cow::Borrowed("com.apple.iTunes"), name: Cow::Owned(key.to_string()) },
                        AtomData::UTF8(value.to_string()),
                    ));
                }
            }
            ilst.save_to_path(path, options)?;
        }
        TagType::Ape => {
            let mut ape = ApeTag::from(tag);
            // APE readers look for the date under Year, and for a file name
            // ending in .jpg on the cover to know it is an image.
            if let Some(date) = values.release_date {
                ape.insert(ApeItem::new("Year".into(), ItemValue::Text(date.to_string()))?);
            }
            if let Some(cover) = &values.cover {
                let picture = Picture::new_unchecked(PictureType::CoverFront, Some(MimeType::Jpeg), Some("cover.jpg".into()), cover.clone());
                ape.insert(ApeItem::new("Cover Art (Front)".into(), ItemValue::Binary(picture.as_ape_bytes()))?);
            }
            for (key, value) in customs {
                if let Some(value) = value {
                    ape.insert(ApeItem::new(key.to_string(), ItemValue::Text(value.to_string()))?);
                }
            }
            ape.save_to_path(path, options)?;
        }
        _ => {
            if file_type == FileType::Wav {
                write_riff_info(path, values)?;
            }
            let mut id3 = Id3v2Tag::from(tag);
            for (key, value) in customs {
                if let Some(value) = value {
                    id3.insert_user_text(key.to_string(), value.to_string());
                }
            }
            id3.save_to_path(path, options)?;
        }
    }
    Ok(Retag::Tagged)
}

fn generic_tag(values: &TagValues) -> Tag {
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title(values.title.to_string());
    tag.set_artist(values.artist.to_string());
    tag.set_album(values.album.to_string());
    let texts = [
        (ItemKey::Genre, values.genre.map(str::to_string)),
        (ItemKey::RecordingDate, values.release_date.map(str::to_string)),
        (ItemKey::Language, values.language.map(str::to_string)),
        (ItemKey::Lyrics, values.lyrics.map(str::to_string)),
        (ItemKey::ReplayGainTrackGain, values.replay_gain_track.map(|db| format!("{db:.2} dB"))),
        (ItemKey::ReplayGainAlbumGain, values.replay_gain_album.map(|db| format!("{db:.2} dB"))),
    ];
    for (key, value) in texts {
        if let Some(value) = value.filter(|v| !v.trim().is_empty()) {
            tag.insert_text(key, value);
        }
    }
    if let Some(cover) = &values.cover {
        tag.push_picture(Picture::new_unchecked(PictureType::CoverFront, Some(MimeType::Jpeg), None, cover.clone()));
    }
    tag
}

/// Windows Explorer reads only RIFF INFO in a WAV, as the ANSI code page, so
/// only plain-ASCII values go there (others would show garbled); players
/// read the ID3v2 tag written beside it.
fn write_riff_info(path: &Path, values: &TagValues) -> Result<()> {
    let mut info = Tag::new(TagType::RiffInfo);
    let fields = [
        (ItemKey::TrackTitle, Some(values.title)),
        (ItemKey::TrackArtist, Some(values.artist)),
        (ItemKey::AlbumTitle, Some(values.album)),
        (ItemKey::Genre, values.genre),
        (ItemKey::RecordingDate, values.release_date),
    ];
    for (key, value) in fields {
        if let Some(value) = value.filter(|v| !v.is_empty() && v.is_ascii()) {
            info.insert_text(key, value.to_string());
        }
    }
    let info = RiffInfoList::from(info);
    if info.is_empty() {
        let _ = TagType::RiffInfo.remove_from_path(path);
    } else {
        info.save_to_path(path, WriteOptions::new())?;
    }
    Ok(())
}

/// The vault content hash a mirror copy carries ([`HASH_FIELD`]), if any.
pub fn read_mirror_hash(path: &Path) -> Option<String> {
    let read = || -> Option<String> {
        let file = Probe::open(path).ok()?.options(ParseOptions::new().read_properties(false)).guess_file_type().ok()?.read().ok()?;
        file.tags().iter().find_map(|tag| {
            tag.items().find_map(|item| match item.key() {
                ItemKey::Unknown(key) if key.eq_ignore_ascii_case(HASH_FIELD) || key.ends_with(&format!(":{HASH_FIELD}")) => {
                    item.value().text().map(str::to_string)
                }
                _ => None,
            })
        })
    };
    catch_unwind(AssertUnwindSafe(read))
        .ok()
        .flatten()
        .filter(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_detected_type_has_to_fit_the_extension() {
        assert!(fits_extension("mp3", &FileType::Mpeg));
        assert!(fits_extension("alac", &FileType::Mp4));
        assert!(fits_extension("oga", &FileType::Vorbis));
        // Ogg FLAC, which lofty takes for MPEG.
        assert!(!fits_extension("oga", &FileType::Mpeg));
        assert!(!fits_extension("flac", &FileType::Mpeg));
        assert!(!fits_extension("exe", &FileType::Mpeg));
    }

    /// A tenth of a second of 16-bit mono silence.
    fn tiny_wav() -> Vec<u8> {
        let data = vec![0u8; 8820];
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1u16.to_le_bytes()); // mono
        wav.extend_from_slice(&44100u32.to_le_bytes());
        wav.extend_from_slice(&88200u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(&data);
        wav
    }

    #[test]
    fn a_wav_gets_its_details_and_carries_the_hash() {
        let dir = std::env::temp_dir().join(format!("mv-retag-wav-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("song.wav");
        std::fs::write(&path, tiny_wav()).unwrap();
        let hash = "b".repeat(64);
        let values = TagValues {
            title: "আমার গান",
            artist: "Artist",
            album: "Album",
            genre: Some("Folk"),
            language: Some("Bengali"),
            country: Some("Bangladesh"),
            release_date: Some("2019-05-14"),
            lyrics: Some("one\ntwo"),
            replay_gain_track: Some(-8.35),
            replay_gain_album: None,
            content_hash: &hash,
            cover: None,
        };
        assert_eq!(write_tags(&path, "wav", &values).unwrap(), Retag::Tagged);
        assert_eq!(read_mirror_hash(&path).as_deref(), Some(hash.as_str()));
        let file = lofty::read_from_path(&path).unwrap();
        let id3 = file.tag(TagType::Id3v2).unwrap();
        assert_eq!(id3.title().as_deref(), Some("আমার গান"));
        assert_eq!(id3.get_string(&ItemKey::RecordingDate), Some("2019-05-14"));
        // RIFF INFO gets only the plain-ASCII values.
        let info = file.tag(TagType::RiffInfo).unwrap();
        assert_eq!(info.title(), None);
        assert_eq!(info.artist().as_deref(), Some("Artist"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_isnt_audio_is_skipped_untouched() {
        let dir = std::env::temp_dir().join(format!("mv-retag-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("song.flac");
        std::fs::write(&path, b"not audio at all").unwrap();
        let values = TagValues {
            title: "T",
            artist: "A",
            album: "B",
            genre: None,
            language: None,
            country: None,
            release_date: None,
            lyrics: None,
            replay_gain_track: None,
            replay_gain_album: None,
            content_hash: &"a".repeat(64),
            cover: None,
        };
        assert!(!matches!(write_tags(&path, "flac", &values), Ok(Retag::Tagged)));
        assert_eq!(std::fs::read(&path).unwrap(), b"not audio at all");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
