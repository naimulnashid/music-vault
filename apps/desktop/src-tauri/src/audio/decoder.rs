use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use crate::error::{AppError, AppResult};

/// A decode stream that yields interleaved stereo f32, backed by Symphonia
/// for the mainstream formats plus dedicated APE (Monkey's Audio) and
/// WavPack backends (Phase 8d).
///
/// Mono input is duplicated to both channels; multichannel input is folded to
/// its first two channels.
pub struct DecodedStream {
    pub path: String,
    pub sample_rate: u32,
    pub duration_secs: f64,
    backend: Backend,
}

enum Backend {
    Symphonia(SymphoniaStream),
    Ape(ApeStream),
    WavPack(WvStream),
}

impl DecodedStream {
    pub fn open(path: &str) -> AppResult<Self> {
        let p = Path::new(path);
        if !p.exists() {
            return Err(AppError::FileNotFound(path.to_string()));
        }
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();

        let backend = match ext.as_str() {
            "ape" => Backend::Ape(ApeStream::open(p)?),
            "wv" => Backend::WavPack(WvStream::open(p)?),
            _ => Backend::Symphonia(SymphoniaStream::open(path)?),
        };
        let (sample_rate, duration_secs) = match &backend {
            Backend::Symphonia(s) => (s.sample_rate, s.duration_secs),
            Backend::Ape(s) => (s.sample_rate, s.duration_secs),
            Backend::WavPack(s) => (s.sample_rate, s.duration_secs),
        };
        Ok(Self {
            path: path.to_string(),
            sample_rate,
            duration_secs,
            backend,
        })
    }

    pub fn position_secs(&self) -> f64 {
        let frames = match &self.backend {
            Backend::Symphonia(s) => s.frames_emitted,
            Backend::Ape(s) => s.frames_emitted,
            Backend::WavPack(s) => s.frames_emitted,
        };
        frames as f64 / self.sample_rate as f64
    }

    pub fn seek(&mut self, secs: f64) -> AppResult<()> {
        match &mut self.backend {
            Backend::Symphonia(s) => s.seek(secs),
            Backend::Ape(s) => s.seek(secs),
            Backend::WavPack(s) => s.seek(secs),
        }
    }

    /// Fill `out` with up to `max_frames` interleaved stereo frames.
    /// Returns the number of frames written; 0 means end of stream.
    pub fn next_frames(&mut self, out: &mut Vec<f32>, max_frames: usize) -> AppResult<usize> {
        match &mut self.backend {
            Backend::Symphonia(s) => s.next_frames(out, max_frames),
            Backend::Ape(s) => s.next_frames(out, max_frames),
            Backend::WavPack(s) => s.next_frames(out, max_frames),
        }
    }
}

// ---- shared PCM plumbing -----------------------------------------------------

/// Interleave a slice of raw channel-interleaved f32 samples into stereo.
fn push_stereo(pending: &mut Vec<f32>, samples: &[f32], channels: usize) {
    match channels {
        1 => {
            pending.reserve(samples.len() * 2);
            for &s in samples {
                pending.push(s);
                pending.push(s);
            }
        }
        2 => pending.extend_from_slice(samples),
        ch => {
            let frames = samples.len() / ch;
            pending.reserve(frames * 2);
            for f in 0..frames {
                pending.push(samples[f * ch]);
                pending.push(samples[f * ch + 1]);
            }
        }
    }
}

/// Drain up to `max_frames` stereo frames from a pending buffer into `out`.
fn drain_pending(
    pending: &mut Vec<f32>,
    pending_offset: &mut usize,
    out: &mut Vec<f32>,
    max_frames: usize,
) -> usize {
    let avail_frames = (pending.len() - *pending_offset) / 2;
    let take = avail_frames.min(max_frames);
    let start = *pending_offset;
    out.extend_from_slice(&pending[start..start + take * 2]);
    *pending_offset += take * 2;
    take
}

// ---- Symphonia (mp3/flac/wav/ogg/m4a/aac/alac/…) -------------------------------

/// `enable_gapless` trims mp3/aac encoder delay and padding so back-to-back
/// tracks splice sample-accurately.
struct SymphoniaStream {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    sample_rate: u32,
    duration_secs: f64,
    /// Interleaved stereo samples decoded but not yet consumed.
    pending: Vec<f32>,
    pending_offset: usize,
    /// Stereo frames handed out since the start of the track.
    frames_emitted: u64,
    eof: bool,
}

impl SymphoniaStream {
    fn open(path: &str) -> AppResult<Self> {
        let p = Path::new(path);
        let file = File::open(p)?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let format_opts = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &MetadataOptions::default())
            .map_err(|e| AppError::UnsupportedFormat(format!("{path}: {e}")))?;

        let format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| AppError::UnsupportedFormat(format!("{path}: no decodable track")))?;
        let track_id = track.id;
        let params = &track.codec_params;

        let sample_rate = params
            .sample_rate
            .ok_or_else(|| AppError::UnsupportedFormat(format!("{path}: unknown sample rate")))?;
        let duration_secs = match (params.time_base, params.n_frames) {
            (Some(tb), Some(n)) => {
                let t = tb.calc_time(n);
                t.seconds as f64 + t.frac
            }
            _ => 0.0,
        };

        let decoder = symphonia::default::get_codecs()
            .make(params, &DecoderOptions::default())
            .map_err(|e| AppError::UnsupportedFormat(format!("{path}: {e}")))?;

        Ok(Self {
            format,
            decoder,
            track_id,
            sample_rate,
            duration_secs,
            pending: Vec::new(),
            pending_offset: 0,
            frames_emitted: 0,
            eof: false,
        })
    }

    fn seek(&mut self, secs: f64) -> AppResult<()> {
        let secs = secs.max(0.0);
        let seeked = self
            .format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: Time::from(secs),
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|e| AppError::Decode(format!("seek failed: {e}")))?;
        self.decoder.reset();
        self.pending.clear();
        self.pending_offset = 0;
        self.eof = false;
        // Convert the actual landing timestamp back to frames for position.
        if let Some(tb) = self.decoder.codec_params().time_base {
            let t = tb.calc_time(seeked.actual_ts);
            self.frames_emitted =
                ((t.seconds as f64 + t.frac) * self.sample_rate as f64).round() as u64;
        } else {
            self.frames_emitted = (secs * self.sample_rate as f64).round() as u64;
        }
        Ok(())
    }

    /// Decode the next packet into `pending` as interleaved stereo.
    fn decode_more(&mut self) -> AppResult<()> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(symphonia::core::errors::Error::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    self.eof = true;
                    return Ok(());
                }
                Err(symphonia::core::errors::Error::ResetRequired) => {
                    self.eof = true;
                    return Ok(());
                }
                Err(e) => return Err(AppError::Decode(e.to_string())),
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    if decoded.frames() == 0 {
                        continue;
                    }
                    let spec = *decoded.spec();
                    let frames = decoded.frames();
                    let ch = spec.channels.count().max(1);
                    let mut buf = SampleBuffer::<f32>::new(frames as u64, spec);
                    buf.copy_interleaved_ref(decoded);

                    self.pending.drain(..self.pending_offset);
                    self.pending_offset = 0;
                    push_stereo(&mut self.pending, buf.samples(), ch);
                    return Ok(());
                }
                // Recoverable decode hiccup: skip the packet and continue.
                Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
                Err(e) => return Err(AppError::Decode(e.to_string())),
            }
        }
    }

    fn next_frames(&mut self, out: &mut Vec<f32>, max_frames: usize) -> AppResult<usize> {
        let mut written = 0usize;
        while written < max_frames {
            if self.pending_offset >= self.pending.len() {
                if self.eof {
                    break;
                }
                self.decode_more()?;
                if self.pending_offset >= self.pending.len() && self.eof {
                    break;
                }
                continue;
            }
            written += drain_pending(
                &mut self.pending,
                &mut self.pending_offset,
                out,
                max_frames - written,
            );
        }
        self.frames_emitted += written as u64;
        Ok(written)
    }
}

// ---- Monkey's Audio (.ape) ----------------------------------------------------

struct ApeStream {
    dec: ape_decoder::ApeDecoder<BufReader<File>>,
    sample_rate: u32,
    duration_secs: f64,
    channels: usize,
    bits: u16,
    signed_8bit: bool,
    total_frames: u32,
    /// Next APE frame (a multi-second block of samples) to decode.
    next_frame: u32,
    /// Sample frames to drop from the next decoded frame (post-seek).
    skip_samples: u32,
    pending: Vec<f32>,
    pending_offset: usize,
    frames_emitted: u64,
}

impl ApeStream {
    fn open(p: &Path) -> AppResult<Self> {
        let reader = BufReader::new(File::open(p)?);
        let dec = ape_decoder::ApeDecoder::new(reader)
            .map_err(|e| AppError::UnsupportedFormat(format!("{}: {e:?}", p.display())))?;
        let info = dec.info().clone();
        if info.is_floating_point {
            return Err(AppError::UnsupportedFormat(format!(
                "{}: floating-point APE is not supported",
                p.display()
            )));
        }
        if info.sample_rate == 0 {
            return Err(AppError::UnsupportedFormat(format!(
                "{}: unknown sample rate",
                p.display()
            )));
        }
        Ok(Self {
            sample_rate: info.sample_rate,
            duration_secs: info.total_samples as f64 / info.sample_rate as f64,
            channels: (info.channels as usize).max(1),
            bits: info.bits_per_sample,
            signed_8bit: info.is_signed_8bit,
            total_frames: info.total_frames,
            dec,
            next_frame: 0,
            skip_samples: 0,
            pending: Vec::new(),
            pending_offset: 0,
            frames_emitted: 0,
        })
    }

    fn seek(&mut self, secs: f64) -> AppResult<()> {
        let sample = (secs.max(0.0) * self.sample_rate as f64).round() as u64;
        let r = self
            .dec
            .seek(sample)
            .map_err(|e| AppError::Decode(format!("APE seek failed: {e:?}")))?;
        self.next_frame = r.frame_index;
        self.skip_samples = r.skip_samples;
        self.pending.clear();
        self.pending_offset = 0;
        self.frames_emitted = r.actual_sample;
        Ok(())
    }

    /// Decode the next APE frame into `pending` as interleaved stereo f32.
    fn decode_more(&mut self) -> AppResult<bool> {
        if self.next_frame >= self.total_frames {
            return Ok(false);
        }
        let raw = self
            .dec
            .decode_frame(self.next_frame)
            .map_err(|e| AppError::Decode(format!("APE decode failed: {e:?}")))?;
        self.next_frame += 1;

        let bytes_per = (self.bits as usize).div_ceil(8);
        let mut samples: Vec<f32> = Vec::with_capacity(raw.len() / bytes_per);
        for chunk in raw.chunks_exact(bytes_per) {
            samples.push(match self.bits {
                8 => {
                    if self.signed_8bit {
                        chunk[0] as i8 as f32 / 128.0
                    } else {
                        (chunk[0] as f32 - 128.0) / 128.0
                    }
                }
                16 => i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32_768.0,
                24 => {
                    let v = i32::from_le_bytes([0, chunk[0], chunk[1], chunk[2]]) >> 8;
                    v as f32 / 8_388_608.0
                }
                32 => i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f32
                    / 2_147_483_648.0,
                b => {
                    return Err(AppError::UnsupportedFormat(format!(
                        "APE: unsupported bit depth {b}"
                    )))
                }
            });
        }
        // Post-seek: drop the leading samples before the seek target.
        let skip = (self.skip_samples as usize) * self.channels;
        self.skip_samples = 0;
        let samples = if skip < samples.len() { &samples[skip..] } else { &[][..] };

        self.pending.drain(..self.pending_offset);
        self.pending_offset = 0;
        push_stereo(&mut self.pending, samples, self.channels);
        Ok(true)
    }

    fn next_frames(&mut self, out: &mut Vec<f32>, max_frames: usize) -> AppResult<usize> {
        let mut written = 0usize;
        while written < max_frames {
            if self.pending_offset >= self.pending.len() {
                if !self.decode_more()? {
                    break;
                }
                continue;
            }
            written += drain_pending(
                &mut self.pending,
                &mut self.pending_offset,
                out,
                max_frames - written,
            );
        }
        self.frames_emitted += written as u64;
        Ok(written)
    }
}

// ---- WavPack (.wv) --------------------------------------------------------------

/// Frames unpacked per call.
const WV_CHUNK_FRAMES: usize = 4096;

struct WvStream {
    reader: super::wv::WvReader,
    sample_rate: u32,
    duration_secs: f64,
    channels: usize,
    is_float: bool,
    /// 1 / 2^(bits-1) for integer files.
    norm: f32,
    unpack_buf: Vec<i32>,
    pending: Vec<f32>,
    pending_offset: usize,
    frames_emitted: u64,
    eof: bool,
}

impl WvStream {
    fn open(p: &Path) -> AppResult<Self> {
        let reader = super::wv::WvReader::open(p)?;
        let sample_rate = reader.sample_rate();
        let channels = reader.num_channels();
        let bits = reader.bits_per_sample();
        let is_float = reader.mode() & super::wv::MODE_FLOAT != 0;
        let total = reader.num_samples();
        if sample_rate == 0 {
            return Err(AppError::UnsupportedFormat(format!(
                "{}: unknown sample rate",
                p.display()
            )));
        }
        Ok(Self {
            sample_rate,
            duration_secs: if total > 0 {
                total as f64 / sample_rate as f64
            } else {
                0.0
            },
            channels,
            is_float,
            norm: 1.0 / (1i64 << (bits - 1)) as f32,
            unpack_buf: vec![0i32; WV_CHUNK_FRAMES * channels],
            reader,
            pending: Vec::new(),
            pending_offset: 0,
            frames_emitted: 0,
            eof: false,
        })
    }

    fn seek(&mut self, secs: f64) -> AppResult<()> {
        let sample = (secs.max(0.0) * self.sample_rate as f64).round() as i64;
        if !self.reader.seek_sample(sample) {
            return Err(AppError::Decode("WavPack seek failed".into()));
        }
        self.pending.clear();
        self.pending_offset = 0;
        self.eof = false;
        self.frames_emitted = sample.max(0) as u64;
        Ok(())
    }

    fn decode_more(&mut self) -> AppResult<()> {
        let got = self.reader.unpack(&mut self.unpack_buf, WV_CHUNK_FRAMES as u32) as usize;
        if got == 0 {
            self.eof = true;
            return Ok(());
        }
        let samples: Vec<f32> = self.unpack_buf[..got * self.channels]
            .iter()
            .map(|&s| {
                if self.is_float {
                    f32::from_bits(s as u32)
                } else {
                    s as f32 * self.norm
                }
            })
            .collect();
        self.pending.drain(..self.pending_offset);
        self.pending_offset = 0;
        push_stereo(&mut self.pending, &samples, self.channels);
        Ok(())
    }

    fn next_frames(&mut self, out: &mut Vec<f32>, max_frames: usize) -> AppResult<usize> {
        let mut written = 0usize;
        while written < max_frames {
            if self.pending_offset >= self.pending.len() {
                if self.eof {
                    break;
                }
                self.decode_more()?;
                if self.pending_offset >= self.pending.len() && self.eof {
                    break;
                }
                continue;
            }
            written += drain_pending(
                &mut self.pending,
                &mut self.pending_offset,
                out,
                max_frames - written,
            );
        }
        self.frames_emitted += written as u64;
        Ok(written)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// Write a self-contained 24-bit/96 kHz stereo sine WAV to a temp file.
    pub fn write_test_wav(secs: f64, rate: u32) -> std::path::PathBuf {
        let n = (rate as f64 * secs) as usize;
        let data_len = n * 6; // 2ch * 3 bytes
        let mut bytes = Vec::with_capacity(44 + data_len);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&2u16.to_le_bytes()); // stereo
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 6).to_le_bytes());
        bytes.extend_from_slice(&6u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&24u16.to_le_bytes()); // bits
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data_len as u32).to_le_bytes());
        for i in 0..n {
            let t = i as f64 / rate as f64;
            let s = (0.3 * (std::f64::consts::TAU * 440.0 * t).sin() * 8_388_607.0) as i32;
            let b = s.to_le_bytes();
            // Left + right identical.
            bytes.extend_from_slice(&b[..3]);
            bytes.extend_from_slice(&b[..3]);
        }
        let path = std::env::temp_dir().join(format!("mv-test-{rate}.wav"));
        std::fs::write(&path, bytes).expect("write test wav");
        path
    }

    #[test]
    fn decodes_hires_wav_at_native_rate() {
        let path = write_test_wav(2.0, 96_000);
        let mut dec = DecodedStream::open(path.to_str().unwrap()).expect("open");
        assert_eq!(dec.sample_rate, 96_000, "must decode at the file's native rate");
        assert!((dec.duration_secs - 2.0).abs() < 0.05, "duration ~2s, got {}", dec.duration_secs);

        let mut out = Vec::new();
        let mut total = 0usize;
        loop {
            out.clear();
            let got = dec.next_frames(&mut out, 4096).expect("decode");
            if got == 0 {
                break;
            }
            assert_eq!(out.len(), got * 2, "interleaved stereo");
            total += got;
        }
        assert_eq!(total, 192_000, "2s at 96kHz, sample-accurate");

        // Seek back to 0.5s and confirm position tracking.
        dec.seek(0.5).expect("seek");
        assert!((dec.position_secs() - 0.5).abs() < 0.05);
        out.clear();
        assert!(dec.next_frames(&mut out, 1024).expect("decode after seek") > 0);
    }

    #[test]
    fn missing_file_reports_not_found() {
        let Err(err) = DecodedStream::open("C:/does/not/exist.flac") else {
            panic!("expected FileNotFound error");
        };
        assert!(matches!(err, crate::error::AppError::FileNotFound(_)));
    }
}
