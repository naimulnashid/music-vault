use std::path::Path;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::prelude::{Accessor, ItemKey};

/// Everything extractable from an audio file's tags and properties.
#[derive(Debug, Default)]
pub struct FileMeta {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    /// "2019", "2019-05" or "2019-05-14", from the tag's release/recording date.
    pub release_date: Option<String>,
    pub language: Option<String>,
    /// ReplayGain gains in dB, parsed from "-8.35 dB"-style tag values.
    pub rg_track_gain: Option<f64>,
    pub rg_album_gain: Option<f64>,
    pub duration: f64,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub channels: Option<i64>,
    pub codec: Option<String>,
    /// Raw bytes + file extension ("jpg"/"png") of the front cover.
    pub artwork: Option<(Vec<u8>, &'static str)>,
    pub lyrics_text: Option<String>,
}

/// Parse a ReplayGain tag value like "-8.35 dB" / "+2.1dB" / "-8.35" into dB.
fn parse_db(s: &str) -> Option<f64> {
    s.trim()
        .trim_end_matches(|c: char| c.eq_ignore_ascii_case(&'b') || c.eq_ignore_ascii_case(&'d'))
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|g| g.is_finite())
}

/// A tag date ("2019", "2019-05-14", "2019-05-14T10:00:00", "2019/5/4") as a
/// release date, keeping as much as is valid — core `releaseDateFromTag`.
pub fn release_date_from_tag(raw: &str) -> Option<String> {
    let s = raw.trim();
    let year = s.get(..4).filter(|y| y.bytes().all(|b| b.is_ascii_digit()))?;
    if year == "0000" {
        return None;
    }
    let mut parts = Vec::new();
    let mut rest = &s[4..];
    while parts.len() < 2 {
        let Some(sep) = rest.chars().next().filter(|c| matches!(c, '-' | '/' | '.')) else { break };
        let after = &rest[sep.len_utf8()..];
        let digits = after.bytes().take(2).take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            break;
        }
        parts.push(after[..digits].parse::<u32>().ok()?);
        rest = &after[digits..];
    }
    let y: i32 = year.parse().ok()?;
    if let [m, d] = parts[..] {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let days = match m {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if leap => 29,
            2 => 28,
            _ => 0,
        };
        if (1..=days).contains(&d) {
            return Some(format!("{year}-{m:02}-{d:02}"));
        }
    }
    match parts.first() {
        Some(&m) if (1..=12).contains(&m) => Some(format!("{year}-{m:02}")),
        _ => Some(year.to_string()),
    }
}

/// Best-effort tag read — mirrors the tolerant behavior of the web importer
/// (music-metadata with filename fallback). Never fails: an unreadable file
/// yields default metadata and the caller falls back to the filename.
pub fn read_meta(path: &Path) -> FileMeta {
    let mut meta = FileMeta::default();

    let tagged = match lofty::read_from_path(path) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "tag parse failed");
            return meta;
        }
    };

    let props = tagged.properties();
    meta.duration = props.duration().as_secs_f64();
    meta.sample_rate = props.sample_rate().map(|r| r as i64);
    meta.bit_depth = props.bit_depth().map(|b| b as i64);
    meta.channels = props.channels().map(|c| c as i64);
    meta.codec = Some(format!("{:?}", tagged.file_type()));

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let Some(tag) = tag else { return meta };

    meta.title = tag.title().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    meta.artist = tag.artist().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    meta.album = tag.album().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    // Multi-valued genres: take the first, like the web importer did.
    meta.genre = tag
        .genre()
        .map(|s| s.split(['/', ';']).next().unwrap_or(&s).trim().to_string())
        .filter(|s| !s.is_empty());
    meta.release_date = [ItemKey::ReleaseDate, ItemKey::RecordingDate, ItemKey::Year]
        .iter()
        .filter_map(|key| tag.get_string(key))
        .find_map(release_date_from_tag)
        .or_else(|| tag.year().and_then(|y| release_date_from_tag(&y.to_string())));

    // TLAN (ID3v2) / LANGUAGE (Vorbis) map to ItemKey::Language in lofty.
    meta.language = tag
        .get_string(&ItemKey::Language)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    meta.rg_track_gain = tag.get_string(&ItemKey::ReplayGainTrackGain).and_then(parse_db);
    meta.rg_album_gain = tag.get_string(&ItemKey::ReplayGainAlbumGain).and_then(parse_db);

    meta.lyrics_text = tag
        .get_string(&ItemKey::Lyrics)
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());

    // Front cover preferred, else the first embedded picture.
    let picture = tag
        .pictures()
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| tag.pictures().first());
    if let Some(pic) = picture {
        let ext = match pic.mime_type() {
            Some(m) if m.as_str() == "image/png" => "png",
            _ => "jpg",
        };
        meta.artwork = Some((pic.data().to_vec(), ext));
    }

    meta
}

#[cfg(test)]
mod tests {
    use super::release_date_from_tag;

    #[test]
    fn release_dates_from_tags_match_core() {
        assert_eq!(release_date_from_tag("2019").as_deref(), Some("2019"));
        assert_eq!(release_date_from_tag("2019-05-14T10:00:00").as_deref(), Some("2019-05-14"));
        assert_eq!(release_date_from_tag("2019/5/4").as_deref(), Some("2019-05-04"));
        assert_eq!(release_date_from_tag("2019-02-30").as_deref(), Some("2019-02"));
        assert_eq!(release_date_from_tag("2024-02-29").as_deref(), Some("2024-02-29"));
        assert_eq!(release_date_from_tag("2019-13-01").as_deref(), Some("2019"));
        assert_eq!(release_date_from_tag("0000"), None);
        assert_eq!(release_date_from_tag("May 2019"), None);
    }
}
