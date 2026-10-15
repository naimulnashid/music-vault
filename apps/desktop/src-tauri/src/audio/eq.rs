use biquad::{Biquad, Coefficients, DirectForm2Transposed, Hertz, Type, Q_BUTTERWORTH_F32};

pub const EQ_FREQS: [f32; 10] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

/// 10-band peaking EQ, one filter chain per stereo channel (Q = 1, ±12 dB),
/// mirroring the Web Audio BiquadFilter chain of the original app.
pub struct EqChain {
    filters: [[DirectForm2Transposed<f32>; 10]; 2],
    gains: [f32; 10],
    sample_rate: u32,
    /// All-flat fast path: skip processing entirely.
    bypass: bool,
}

fn coeffs(freq: f32, gain_db: f32, sample_rate: u32) -> Coefficients<f32> {
    // Keep the band center below Nyquist for low output rates.
    let f0 = freq.min(sample_rate as f32 * 0.45);
    Coefficients::<f32>::from_params(
        Type::PeakingEQ(gain_db),
        Hertz::<f32>::from_hz(sample_rate as f32).unwrap(),
        Hertz::<f32>::from_hz(f0).unwrap(),
        1.0,
    )
    .unwrap_or_else(|_| {
        // Degenerate parameters — fall back to a unity band.
        Coefficients::<f32>::from_params(
            Type::AllPass,
            Hertz::<f32>::from_hz(sample_rate as f32).unwrap(),
            Hertz::<f32>::from_hz(f0).unwrap(),
            Q_BUTTERWORTH_F32,
        )
        .expect("allpass coefficients")
    })
}

impl EqChain {
    pub fn new(sample_rate: u32) -> Self {
        let gains = [0.0; 10];
        let mk = || {
            core::array::from_fn::<_, 10, _>(|i| {
                DirectForm2Transposed::<f32>::new(coeffs(EQ_FREQS[i], 0.0, sample_rate))
            })
        };
        Self {
            filters: [mk(), mk()],
            gains,
            sample_rate,
            bypass: true,
        }
    }

    pub fn set_gains(&mut self, gains: [f32; 10]) {
        self.gains = gains;
        self.rebuild();
    }

    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        if self.sample_rate != sample_rate {
            self.sample_rate = sample_rate;
            self.rebuild();
        }
    }

    fn rebuild(&mut self) {
        self.bypass = self.gains.iter().all(|g| g.abs() < 0.01);
        for ch in &mut self.filters {
            for (i, f) in ch.iter_mut().enumerate() {
                f.update_coefficients(coeffs(EQ_FREQS[i], self.gains[i].clamp(-12.0, 12.0), self.sample_rate));
                f.reset_state();
            }
        }
    }

    /// Process an interleaved stereo buffer in place.
    pub fn process(&mut self, buf: &mut [f32]) {
        if self.bypass {
            return;
        }
        for frame in buf.chunks_exact_mut(2) {
            for (ch, sample) in frame.iter_mut().enumerate() {
                let mut s = *sample;
                for f in &mut self.filters[ch] {
                    s = f.run(s);
                }
                *sample = s;
            }
        }
    }
}
