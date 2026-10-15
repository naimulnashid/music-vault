use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender};
use tauri::AppHandle;

use super::analyzer::Analyzer;
use super::decoder::DecodedStream;
use super::eq::EqChain;
use super::events;
use super::output::{Output, OutputEvent};
use super::resampler::StereoResampler;
use super::Cmd;
use crate::error::AppResult;

/// Output frames produced per mix iteration (~21 ms at 48 kHz).
const BLOCK_FRAMES: usize = 1024;
const POSITION_INTERVAL: Duration = Duration::from_millis(250);
const SPECTRUM_INTERVAL: Duration = Duration::from_millis(33);
/// Per-sample smoothing toward the volume target (~10 ms at 48 kHz).
const VOLUME_SMOOTHING: f32 = 0.002;

/// One playing/preloaded track: decoder + optional rate adaptation + a fade
/// gain used as the crossfade envelope (1.0 when not fading).
struct StreamState {
    dec: DecodedStream,
    resampler: Option<StereoResampler>,
    /// Resampled output awaiting consumption (interleaved stereo).
    out_pending: Vec<f32>,
    gain: f32,
    /// Per-frame gain increment while a crossfade ramp is running.
    gain_step: f32,
    /// ReplayGain as a linear factor (1.0 = no adjustment), fixed per track.
    rg_gain: f32,
    finished: bool,
}

impl StreamState {
    fn new(dec: DecodedStream, out_rate: u32, rg_gain: f32) -> AppResult<Self> {
        let resampler = if dec.sample_rate != out_rate {
            Some(StereoResampler::new(dec.sample_rate, out_rate)?)
        } else {
            None
        };
        Ok(Self {
            dec,
            resampler,
            out_pending: Vec::new(),
            gain: 1.0,
            gain_step: 0.0,
            rg_gain,
            finished: false,
        })
    }

    fn remaining_secs(&self) -> f64 {
        (self.dec.duration_secs - self.dec.position_secs()).max(0.0)
    }

    /// Fill `out` with exactly `frames` stereo frames (zero-padded past EOF),
    /// with this stream's ReplayGain already applied.
    /// Returns the number of real (non-padding) frames.
    fn pull(&mut self, frames: usize, out: &mut Vec<f32>) -> AppResult<usize> {
        let appended_at = out.len();
        let mut raw: Vec<f32> = Vec::with_capacity(frames * 2);
        while self.out_pending.len() < frames * 2 && !self.finished {
            raw.clear();
            let got = self.dec.next_frames(&mut raw, frames)?;
            if got == 0 {
                if let Some(rs) = self.resampler.as_mut() {
                    rs.flush(&mut self.out_pending)?;
                }
                self.finished = true;
                break;
            }
            match self.resampler.as_mut() {
                Some(rs) => rs.process(&raw, &mut self.out_pending)?,
                None => self.out_pending.extend_from_slice(&raw),
            }
        }
        let have = (self.out_pending.len() / 2).min(frames);
        out.extend(self.out_pending.drain(..have * 2));
        out.resize(out.len() + (frames - have) * 2, 0.0);
        if self.rg_gain != 1.0 {
            for s in &mut out[appended_at..] {
                *s *= self.rg_gain;
            }
        }
        Ok(have)
    }
}

/// ReplayGain dB → linear factor; None (tag missing / RG off) is unity.
fn rg_linear(db: Option<f64>) -> f32 {
    db.map(|d| 10f32.powf(d.clamp(-24.0, 24.0) as f32 / 20.0))
        .unwrap_or(1.0)
}

pub struct Engine {
    app: AppHandle,
    rx: Receiver<Cmd>,
    out_events_tx: Sender<OutputEvent>,
    out_events_rx: Receiver<OutputEvent>,
    out: Option<Output>,
    resampling: bool,
    current: Option<StreamState>,
    /// Armed next track for gapless/crossfade splicing.
    preloaded: Option<StreamState>,
    /// Outgoing track while a crossfade ramp runs.
    fading_out: Option<StreamState>,
    playing: bool,
    volume_target: f32,
    volume_actual: f32,
    eq: EqChain,
    eq_gains: [f32; 10],
    crossfade: f32,
    gapless: bool,
    visualizer: bool,
    analyzer: Analyzer,
    last_position_emit: Instant,
    last_spectrum_emit: Instant,
    mix_buf: Vec<f32>,
    aux_buf: Vec<f32>,
}

impl Engine {
    pub fn new(app: AppHandle, rx: Receiver<Cmd>) -> Self {
        let (out_events_tx, out_events_rx) = crossbeam_channel::unbounded();
        Self {
            app,
            rx,
            out_events_tx,
            out_events_rx,
            out: None,
            resampling: false,
            current: None,
            preloaded: None,
            fading_out: None,
            playing: false,
            volume_target: 0.8,
            volume_actual: 0.8,
            eq: EqChain::new(48_000),
            eq_gains: [0.0; 10],
            crossfade: 0.0,
            gapless: true,
            visualizer: false,
            analyzer: Analyzer::new(),
            last_position_emit: Instant::now(),
            last_spectrum_emit: Instant::now(),
            mix_buf: Vec::with_capacity(BLOCK_FRAMES * 2),
            aux_buf: Vec::with_capacity(BLOCK_FRAMES * 2),
        }
    }

    pub fn run(mut self) {
        tracing::info!("audio engine thread started");
        loop {
            while let Ok(cmd) = self.rx.try_recv() {
                if matches!(cmd, Cmd::Shutdown) {
                    tracing::info!("audio engine shutting down");
                    return;
                }
                self.handle(cmd);
            }
            while let Ok(OutputEvent::StreamError(msg)) = self.out_events_rx.try_recv() {
                self.recover_output(&msg);
            }

            if self.playing && self.current.is_some() {
                self.produce_block();
                self.maybe_emit_position(false);
                self.maybe_emit_spectrum();
            } else {
                // Idle: block briefly on the command channel instead of spinning.
                match self.rx.recv_timeout(Duration::from_millis(30)) {
                    Ok(Cmd::Shutdown) => return,
                    Ok(cmd) => self.handle(cmd),
                    Err(_) => {}
                }
            }
        }
    }

    // ---- command handling ---------------------------------------------------

    fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Load { path, start_at, autoplay, rg_db } => {
                self.load(&path, start_at, autoplay, rg_linear(rg_db))
            }
            Cmd::PreloadNext { path, rg_db } => self.preload(path, rg_linear(rg_db)),
            Cmd::Play => {
                if self.current.is_some() {
                    self.playing = true;
                    events::emit_state(&self.app, true);
                }
            }
            Cmd::Pause => {
                self.snap_transition();
                if self.playing {
                    self.playing = false;
                    events::emit_state(&self.app, false);
                }
            }
            Cmd::Stop => {
                self.current = None;
                self.preloaded = None;
                self.fading_out = None;
                self.playing = false;
                if let Some(out) = &self.out {
                    out.request_flush();
                }
                events::emit_state(&self.app, false);
                events::emit_position(&self.app, 0.0, 0.0);
            }
            Cmd::Seek(t) => self.seek(t),
            Cmd::SetVolume(v) => self.volume_target = v.clamp(0.0, 1.0),
            Cmd::SetEq(bands) => {
                self.eq_gains = bands;
                self.eq.set_gains(bands);
            }
            Cmd::SetCrossfade(s) => self.crossfade = s.max(0.0),
            Cmd::SetGapless(b) => self.gapless = b,
            Cmd::SetVisualizer(b) => self.visualizer = b,
            Cmd::SetRgGain(db) => {
                if let Some(current) = self.current.as_mut() {
                    current.rg_gain = rg_linear(db);
                }
            }
            Cmd::Shutdown => unreachable!("handled in run loop"),
        }
    }

    fn load(&mut self, path: &str, start_at: f64, autoplay: bool, rg_gain: f32) {
        self.preloaded = None;
        self.fading_out = None;

        let mut dec = match DecodedStream::open(path) {
            Ok(d) => d,
            Err(e) => {
                events::emit_error(&self.app, &e.to_string(), Some(path));
                return;
            }
        };
        if start_at > 0.0 {
            if let Err(e) = dec.seek(start_at) {
                tracing::warn!(path, start_at, error = %e, "resume seek failed; starting at 0");
            }
        }
        let duration = dec.duration_secs;
        let rate = dec.sample_rate;

        if !self.ensure_output(rate) {
            return;
        }
        let out_rate = self.out.as_ref().expect("output exists").sample_rate;

        match StreamState::new(dec, out_rate, rg_gain) {
            Ok(state) => {
                self.current = Some(state);
                self.playing = autoplay;
                if let Some(out) = &self.out {
                    out.request_flush();
                }
                events::emit_state(&self.app, autoplay);
                events::emit_position(&self.app, start_at.max(0.0), duration);
                tracing::info!(path, start_at, autoplay, "track loaded");
            }
            Err(e) => events::emit_error(&self.app, &e.to_string(), Some(path)),
        }
    }

    fn preload(&mut self, path: Option<String>, rg_gain: f32) {
        let Some(path) = path else {
            self.preloaded = None;
            return;
        };
        let Some(out) = &self.out else { return };
        let out_rate = out.sample_rate;
        match DecodedStream::open(&path).and_then(|dec| StreamState::new(dec, out_rate, rg_gain)) {
            Ok(state) => {
                tracing::debug!(path, "next track preloaded");
                self.preloaded = Some(state);
            }
            Err(e) => {
                // Not fatal: the queue advances with a normal (non-seamless) load.
                tracing::warn!(path, error = %e, "preload failed");
                self.preloaded = None;
            }
        }
    }

    fn seek(&mut self, t: f64) {
        self.snap_transition();
        let Some(current) = self.current.as_mut() else { return };
        let t = t.clamp(0.0, current.dec.duration_secs.max(0.0));
        if let Err(e) = current.dec.seek(t) {
            events::emit_error(&self.app, &e.to_string(), Some(&current.dec.path.clone()));
            return;
        }
        if let Some(rs) = current.resampler.as_mut() {
            rs.reset();
        }
        current.out_pending.clear();
        current.finished = false;
        if let Some(out) = &self.out {
            out.request_flush();
        }
        self.maybe_emit_position(true);
    }

    /// Cancel a running crossfade the way the web engine's finalizeFade did:
    /// the incoming track snaps to full volume, the outgoing one is dropped.
    fn snap_transition(&mut self) {
        if let Some(current) = self.current.as_mut() {
            current.gain = 1.0;
            current.gain_step = 0.0;
        }
        self.fading_out = None;
    }

    /// Make sure an output stream exists, preferring the track's native rate.
    fn ensure_output(&mut self, desired_rate: u32) -> bool {
        if let Some(out) = &self.out {
            if out.sample_rate == desired_rate {
                self.resampling = false;
                events::emit_device(&self.app, out.sample_rate, &out.device_name.clone(), false);
                return true;
            }
        }
        match Output::open(desired_rate, self.out_events_tx.clone()) {
            Ok((out, resampling)) => {
                self.eq.set_sample_rate(out.sample_rate);
                events::emit_device(&self.app, out.sample_rate, &out.device_name, resampling);
                self.resampling = resampling;
                self.out = Some(out);
                true
            }
            Err(e) => {
                events::emit_error(&self.app, &e.to_string(), None);
                false
            }
        }
    }

    /// Rebuild the stream on the (possibly new) default device after an error.
    fn recover_output(&mut self, reason: &str) {
        tracing::warn!(reason, "output stream error; rebuilding");
        self.out = None;
        let desired = self
            .current
            .as_ref()
            .map(|c| c.dec.sample_rate)
            .unwrap_or(48_000);
        if !self.ensure_output(desired) {
            self.playing = false;
            events::emit_state(&self.app, false);
            return;
        }
        // Streams resample relative to the output rate; rebuild adapters.
        let out_rate = self.out.as_ref().expect("output exists").sample_rate;
        for slot in [&mut self.current, &mut self.preloaded, &mut self.fading_out] {
            if let Some(state) = slot.as_mut() {
                state.out_pending.clear();
                state.resampler = if state.dec.sample_rate != out_rate {
                    StereoResampler::new(state.dec.sample_rate, out_rate).ok()
                } else {
                    None
                };
            }
        }
    }

    // ---- mixing ---------------------------------------------------------------

    fn produce_block(&mut self) {
        let Some(out_rate) = self.out.as_ref().map(|o| o.sample_rate) else {
            self.playing = false;
            return;
        };

        // Start a crossfade once the current track enters the fade window.
        if self.crossfade > 0.0 && self.preloaded.is_some() && self.fading_out.is_none() {
            let remaining = self.current.as_ref().map(|c| c.remaining_secs()).unwrap_or(f64::MAX);
            if remaining <= self.crossfade as f64 && remaining > 0.15 {
                let dur = (self.crossfade as f64).min(remaining).max(0.1);
                let steps = (dur * out_rate as f64) as f32;
                let mut incoming = self.preloaded.take().expect("preloaded checked");
                incoming.gain = 0.0;
                incoming.gain_step = 1.0 / steps;
                if let Some(mut outgoing) = self.current.take() {
                    outgoing.gain_step = -1.0 / steps;
                    self.fading_out = Some(outgoing);
                }
                events::emit_advanced(&self.app, &incoming.dec.path.clone());
                self.current = Some(incoming);
            }
        }

        self.mix_buf.clear();
        let Some(current) = self.current.as_mut() else { return };
        let got = match current.pull(BLOCK_FRAMES, &mut self.mix_buf) {
            Ok(n) => n,
            Err(e) => {
                let path = current.dec.path.clone();
                events::emit_error(&self.app, &e.to_string(), Some(&path));
                self.playing = false;
                events::emit_state(&self.app, false);
                return;
            }
        };
        // Apply the crossfade envelope of the incoming/current track.
        if current.gain_step != 0.0 || current.gain != 1.0 {
            let mut g = current.gain;
            for frame in self.mix_buf.chunks_exact_mut(2) {
                frame[0] *= g;
                frame[1] *= g;
                g = (g + current.gain_step).clamp(0.0, 1.0);
            }
            current.gain = g;
            if current.gain >= 1.0 {
                current.gain_step = 0.0;
            }
        }

        // Mix in the fading-out track, dropping it once silent.
        if let Some(fading) = self.fading_out.as_mut() {
            self.aux_buf.clear();
            let _ = fading.pull(BLOCK_FRAMES, &mut self.aux_buf);
            let mut g = fading.gain;
            for (i, frame) in self.aux_buf.chunks_exact(2).enumerate() {
                self.mix_buf[i * 2] += frame[0] * g;
                self.mix_buf[i * 2 + 1] += frame[1] * g;
                g = (g + fading.gain_step).clamp(0.0, 1.0);
            }
            fading.gain = g;
            if fading.gain <= 0.0 || fading.finished {
                self.fading_out = None;
            }
        }

        // Track ended inside this block?
        if got < BLOCK_FRAMES {
            let boundary = got * 2;
            if self.gapless && self.preloaded.is_some() {
                // Sample-accurate gapless splice: continue the block from the
                // next track right where the current one ran out.
                let mut next = self.preloaded.take().expect("preloaded checked");
                self.aux_buf.clear();
                match next.pull(BLOCK_FRAMES - got, &mut self.aux_buf) {
                    Ok(_) => {
                        self.mix_buf.truncate(boundary);
                        self.mix_buf.extend_from_slice(&self.aux_buf);
                        events::emit_advanced(&self.app, &next.dec.path.clone());
                        self.current = Some(next);
                    }
                    Err(e) => {
                        events::emit_error(&self.app, &e.to_string(), Some(&next.dec.path.clone()));
                        self.finish_playback(boundary);
                    }
                }
            } else {
                self.finish_playback(boundary);
            }
        }

        // EQ -> smoothed volume -> ring buffer -> analyzer tap.
        self.eq.process(&mut self.mix_buf);
        let mut vol = self.volume_actual;
        let target = self.volume_target;
        for s in self.mix_buf.iter_mut() {
            vol += (target - vol) * VOLUME_SMOOTHING;
            *s *= vol;
        }
        self.volume_actual = vol;

        if self.visualizer {
            self.analyzer.feed(&self.mix_buf);
        }

        if let Some(out) = self.out.as_mut() {
            for &s in &self.mix_buf {
                loop {
                    match out.producer.push(s) {
                        Ok(()) => break,
                        Err(_) => std::thread::sleep(Duration::from_millis(1)),
                    }
                }
            }
        }
    }

    /// The queue ran dry (no preload armed): report ended and go idle, leaving
    /// the decoded track loaded so a repeat-one seek(0) can restart it.
    fn finish_playback(&mut self, mixed_samples: usize) {
        self.mix_buf.truncate(mixed_samples);
        self.playing = false;
        events::emit_state(&self.app, false);
        events::emit_ended(&self.app);
        tracing::debug!("playback reached end of loaded track");
    }

    // ---- reporting ------------------------------------------------------------

    fn maybe_emit_position(&mut self, force: bool) {
        if !force && self.last_position_emit.elapsed() < POSITION_INTERVAL {
            return;
        }
        if let Some(current) = &self.current {
            self.last_position_emit = Instant::now();
            events::emit_position(
                &self.app,
                current.dec.position_secs(),
                current.dec.duration_secs,
            );
        }
    }

    fn maybe_emit_spectrum(&mut self) {
        if !self.visualizer || self.last_spectrum_emit.elapsed() < SPECTRUM_INTERVAL {
            return;
        }
        self.last_spectrum_emit = Instant::now();
        let (freq, wave) = self.analyzer.frame();
        events::emit_spectrum(&self.app, freq, wave);
    }
}
