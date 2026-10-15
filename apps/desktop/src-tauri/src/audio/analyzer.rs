use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::Arc;

const FFT_SIZE: usize = 1024;
const FREQ_BINS: usize = 128;
const WAVE_SAMPLES: usize = 256;
const SMOOTHING: f32 = 0.8;
const MIN_DB: f32 = -100.0;
const MAX_DB: f32 = -30.0;

/// Emulates the Web Audio AnalyserNode the old visualizer consumed:
/// byte-scaled frequency magnitudes (dB range [-100, -30], smoothing 0.8)
/// and byte-scaled time-domain samples.
pub struct Analyzer {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    /// Mono ring of the most recent samples.
    ring: Vec<f32>,
    ring_pos: usize,
    smoothed: Vec<f32>,
    scratch: Vec<Complex<f32>>,
}

impl Analyzer {
    pub fn new() -> Self {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let window = (0..FFT_SIZE)
            .map(|i| {
                let x = std::f32::consts::TAU * i as f32 / FFT_SIZE as f32;
                0.5 * (1.0 - x.cos())
            })
            .collect();
        Self {
            fft,
            window,
            ring: vec![0.0; FFT_SIZE],
            ring_pos: 0,
            smoothed: vec![0.0; FFT_SIZE / 2],
            scratch: vec![Complex::default(); FFT_SIZE],
        }
    }

    /// Feed the post-volume interleaved stereo output block (mono-mixed here).
    pub fn feed(&mut self, interleaved: &[f32]) {
        for frame in interleaved.chunks_exact(2) {
            self.ring[self.ring_pos] = (frame[0] + frame[1]) * 0.5;
            self.ring_pos = (self.ring_pos + 1) % FFT_SIZE;
        }
    }

    /// Compute a spectrum + waveform frame shaped like AnalyserNode output.
    pub fn frame(&mut self) -> (Vec<u8>, Vec<u8>) {
        // Copy the ring in time order, windowed.
        for i in 0..FFT_SIZE {
            let s = self.ring[(self.ring_pos + i) % FFT_SIZE];
            self.scratch[i] = Complex::new(s * self.window[i], 0.0);
        }
        self.fft.process(&mut self.scratch);

        // Smooth magnitudes across frames (like smoothingTimeConstant), then
        // convert to dB and byte-scale.
        let norm = 1.0 / FFT_SIZE as f32;
        let mut freq = vec![0u8; FREQ_BINS];
        let group = (FFT_SIZE / 2) / FREQ_BINS; // 4 raw bins per output bin
        for (i, sm) in self.smoothed.iter_mut().enumerate() {
            let mag = self.scratch[i].norm() * norm;
            *sm = SMOOTHING * *sm + (1.0 - SMOOTHING) * mag;
        }
        for (b, out) in freq.iter_mut().enumerate() {
            let start = b * group;
            let avg: f32 =
                self.smoothed[start..start + group].iter().sum::<f32>() / group as f32;
            let db = 20.0 * avg.max(1e-10).log10();
            let scaled = (db - MIN_DB) / (MAX_DB - MIN_DB);
            *out = (scaled.clamp(0.0, 1.0) * 255.0) as u8;
        }

        // Last WAVE_SAMPLES mono samples, byte-scaled around 128.
        let mut wave = vec![0u8; WAVE_SAMPLES];
        for (i, out) in wave.iter_mut().enumerate() {
            let idx = (self.ring_pos + FFT_SIZE - WAVE_SAMPLES + i) % FFT_SIZE;
            let v = self.ring[idx].clamp(-1.0, 1.0);
            *out = (128.0 + v * 127.0) as u8;
        }

        (freq, wave)
    }
}
