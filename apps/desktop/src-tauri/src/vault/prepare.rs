//! Turning files the user picked into upload-ready parts: identity hashes,
//! the file's own tags (they only pre-fill the upload form), technical
//! properties, and covers in the vault's format.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use image::imageops::FilterType;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::scan;

/// Audio extensions the vault accepts — must equal AUDIO_EXTS in
/// packages/core/src/upload.ts and supabase/functions/vault/keys.ts.
pub const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "mp4", "aac", "alac", "aiff", "aif", "ape", "wv",
];

/// Cover rules (core upload.ts): square centre crop, ≤ 1200 px JPEG + 256 px thumb.
pub const COVER_MAX_PX: u32 = 1200;
pub const COVER_THUMB_PX: u32 = 256;
const COVER_JPEG_QUALITY: u8 = 88;

/// A cover ready to upload: `full_path`/`thumb_path` are staged JPEGs named
/// by the SHA-256 of the full-size image (the vault's art object name).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCover {
    pub sha256: String,
    pub full_path: String,
    pub thumb_path: String,
    pub full_size: u64,
    pub thumb_size: u64,
}

/// Facts read from the audio itself — shown, never editable. Field names match
/// the Supabase columns (core `TechnicalProps`).
#[derive(Serialize, Clone, Debug, Default)]
pub struct Technical {
    pub duration: f64,
    pub codec: Option<String>,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub channels: Option<i64>,
    pub replaygain_track_db: Option<f64>,
    pub replaygain_album_db: Option<f64>,
}

/// The file's own tags, keyed like the Supabase columns (core `TrackEditPatch`).
/// Absent tags are omitted so the form starts blank for them.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Tags {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lyrics_text: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFile {
    pub path: String,
    pub file_name: String,
    pub file_size: u64,
    /// BLAKE3 of the bytes — the track's identity in the vault.
    pub content_hash: String,
    pub ext: String,
    pub technical: Technical,
    pub tags: Tags,
    /// Contents of a sibling `.lrc` file, if any (synced lyrics).
    pub lrc: Option<String>,
    pub cover: Option<PreparedCover>,
    /// For a copy from the library mirror: the content hash of the vault file
    /// it was made from (its own hash differs, its tags having been rewritten).
    pub mirror_of: Option<String>,
}

/// The vault extension for a path, or None when the format isn't supported.
pub fn audio_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    AUDIO_EXTS.contains(&ext.as_str()).then_some(ext)
}

/// Everything the upload form needs from one picked file. Covers are staged
/// under `staging_dir`.
pub fn prepare_file(path: &Path, staging_dir: &Path) -> Result<PreparedFile> {
    let Some(ext) = audio_ext(path) else {
        bail!("{} isn't a supported audio format", path.display());
    };
    let file_size = std::fs::metadata(path)?.len();
    if file_size == 0 {
        bail!("{} is empty", path.display());
    }
    let content_hash = scan::hash::hash_file(path).with_context(|| format!("can't read {}", path.display()))?;
    let meta = scan::tags::read_meta(path);

    let cover = match &meta.artwork {
        Some((bytes, _)) => match prepare_cover(bytes, staging_dir) {
            Ok(cover) => Some(cover),
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "embedded cover unusable");
                None
            }
        },
        None => None,
    };

    let lrc = std::fs::read_to_string(path.with_extension("lrc")).ok().filter(|s| !s.trim().is_empty());
    let mirror_of = super::retag::read_mirror_hash(path).filter(|h| *h != content_hash);

    Ok(PreparedFile {
        path: path.to_string_lossy().to_string(),
        file_name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        file_size,
        content_hash,
        ext,
        technical: Technical {
            duration: meta.duration,
            codec: meta.codec,
            sample_rate: meta.sample_rate,
            bit_depth: meta.bit_depth,
            channels: meta.channels,
            replaygain_track_db: meta.rg_track_gain,
            replaygain_album_db: meta.rg_album_gain,
        },
        tags: Tags {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            genre: meta.genre,
            language: meta.language,
            release_date: meta.release_date,
            lyrics_text: meta.lyrics_text,
        },
        lrc,
        cover,
        mirror_of,
    })
}

/// Square-crops, resizes and JPEG-encodes an image into the vault's cover
/// format, staging `<sha256>.jpg` and `<sha256>.thumb.jpg` in `staging_dir`.
pub fn prepare_cover(bytes: &[u8], staging_dir: &Path) -> Result<PreparedCover> {
    let img = match image::load_from_memory(bytes) {
        Ok(img) => img,
        Err(_) if looks_like_svg(bytes) => render_svg(bytes)?,
        Err(e) => return Err(e).context("not a readable image"),
    };
    let (w, h) = (img.width(), img.height());
    let size = w.min(h);
    if size == 0 {
        bail!("image has no pixels");
    }
    let square = img.crop_imm((w - size) / 2, (h - size) / 2, size, size);

    let full = encode_jpeg(&square, size.min(COVER_MAX_PX))?;
    let thumb = encode_jpeg(&square, size.min(COVER_THUMB_PX))?;
    let sha256 = format!("{:x}", Sha256::digest(&full));

    std::fs::create_dir_all(staging_dir)?;
    let full_path = staging_dir.join(format!("{sha256}.jpg"));
    let thumb_path = staging_dir.join(format!("{sha256}.thumb.jpg"));
    std::fs::write(&full_path, &full)?;
    std::fs::write(&thumb_path, &thumb)?;

    Ok(PreparedCover {
        sha256,
        full_path: path_string(full_path),
        thumb_path: path_string(thumb_path),
        full_size: full.len() as u64,
        thumb_size: thumb.len() as u64,
    })
}

/// An SVG file (plain or with an XML prologue / BOM), judged by its start.
fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_lowercase();
    head.contains("<svg")
}

/// Draws an SVG so its shorter side is the full cover size, on white: a cover
/// is a JPEG, and a transparent background would otherwise turn black.
fn render_svg(bytes: &[u8]) -> Result<image::DynamicImage> {
    use resvg::{tiny_skia, usvg};
    let mut options = usvg::Options::default();
    // Text in the SVG needs the system's fonts; only SVG covers pay for loading them.
    options.fontdb_mut().load_system_fonts();
    let tree = usvg::Tree::from_data(bytes, &options).context("not a readable SVG")?;
    let size = tree.size();
    let short = size.width().min(size.height());
    if short <= 0.0 {
        bail!("image has no pixels");
    }
    let scale = COVER_MAX_PX as f32 / short;
    let width = (size.width() * scale).round().clamp(1.0, 8192.0) as u32;
    let height = (size.height() * scale).round().clamp(1.0, 8192.0) as u32;
    let mut pixmap = tiny_skia::Pixmap::new(width, height).context("SVG too large to draw")?;
    pixmap.fill(tiny_skia::Color::WHITE);
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    // Opaque everywhere after the white fill, so premultiplied RGBA is plain RGBA.
    let rgba = image::RgbaImage::from_raw(width, height, pixmap.take()).context("SVG drawing failed")?;
    Ok(image::DynamicImage::ImageRgba8(rgba))
}

fn encode_jpeg(img: &image::DynamicImage, edge: u32) -> Result<Vec<u8>> {
    let resized = if img.width() == edge {
        img.to_rgb8()
    } else {
        img.resize_exact(edge, edge, FilterType::Lanczos3).to_rgb8()
    };
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, COVER_JPEG_QUALITY).encode_image(&resized)?;
    Ok(out)
}

fn path_string(p: PathBuf) -> String {
    p.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mv-vault-prepare-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(width, height, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img).write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn covers_are_square_capped_and_named_by_their_sha256() {
        let dir = temp_dir("cover");
        let cover = prepare_cover(&png(2000, 1500), &dir).unwrap();

        let full = image::open(&cover.full_path).unwrap();
        let thumb = image::open(&cover.thumb_path).unwrap();
        assert_eq!((full.width(), full.height()), (COVER_MAX_PX, COVER_MAX_PX));
        assert_eq!((thumb.width(), thumb.height()), (COVER_THUMB_PX, COVER_THUMB_PX));

        let bytes = std::fs::read(&cover.full_path).unwrap();
        assert_eq!(cover.sha256, format!("{:x}", Sha256::digest(&bytes)));
        assert_eq!(cover.full_size, bytes.len() as u64);
        assert!(cover.full_path.ends_with(&format!("{}.jpg", cover.sha256)));
        assert!(cover.thumb_path.ends_with(&format!("{}.thumb.jpg", cover.sha256)));
    }

    #[test]
    fn small_covers_are_never_upscaled() {
        let dir = temp_dir("small");
        let cover = prepare_cover(&png(300, 200), &dir).unwrap();
        let full = image::open(&cover.full_path).unwrap();
        let thumb = image::open(&cover.thumb_path).unwrap();
        assert_eq!(full.width(), 200);
        assert_eq!(thumb.width(), 200);
    }

    #[test]
    fn the_same_image_always_gets_the_same_name() {
        let dir = temp_dir("dedupe");
        let a = prepare_cover(&png(400, 400), &dir).unwrap();
        let b = prepare_cover(&png(400, 400), &dir).unwrap();
        assert_eq!(a.sha256, b.sha256);
    }

    #[test]
    fn svg_covers_are_drawn_square_at_full_size() {
        let dir = temp_dir("svg");
        let svg = br##"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#7c3aed"/></svg>"##;
        let cover = prepare_cover(svg, &dir).unwrap();
        let full = image::open(&cover.full_path).unwrap();
        assert_eq!((full.width(), full.height()), (COVER_MAX_PX, COVER_MAX_PX));
        let px = full.to_rgb8().get_pixel(600, 600).0;
        assert!(px[2] > 200 && px[1] < 100, "the shape is drawn, not left white: {px:?}");
    }

    #[test]
    fn unreadable_images_are_rejected() {
        let dir = temp_dir("bad");
        assert!(prepare_cover(b"definitely not an image", &dir).is_err());
    }

    #[test]
    fn hashes_match_independent_computation_and_formats_are_checked() {
        let dir = temp_dir("hash");
        let path = dir.join("tone.flac");
        std::fs::write(&path, b"some audio-ish bytes").unwrap();
        let blake = scan::hash::hash_file(&path).unwrap();
        assert_eq!(blake, blake3::hash(b"some audio-ish bytes").to_hex().to_string());

        assert_eq!(audio_ext(Path::new("A.FLAC")).as_deref(), Some("flac"));
        assert_eq!(audio_ext(Path::new("notes.txt")), None);
        assert!(prepare_file(&dir.join("notes.txt"), &dir).is_err());
    }
}
