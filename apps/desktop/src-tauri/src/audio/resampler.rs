use rubato::{Resampler as _, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

use crate::error::{AppError, AppResult};

const CHUNK_FRAMES: usize = 1024;

/// High-quality sinc resampler adapting a decode stream's rate to the output
/// device rate. Wraps rubato's planar API with interleaved-stereo buffering.
pub struct StereoResampler {
    inner: SincFixedIn<f32>,
    /// Planar input accumulation buffers (left, right).
    in_bufs: [Vec<f32>; 2],
    out_planar: Vec<Vec<f32>>,
}

impl StereoResampler {
    pub fn new(in_rate: u32, out_rate: u32) -> AppResult<Self> {
        let params = SincInterpolationParameters {
            sinc_len: 128,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };
        let inner = SincFixedIn::<f32>::new(
            out_rate as f64 / in_rate as f64,
            2.0,
            params,
            CHUNK_FRAMES,
            2,
        )
        .map_err(|e| AppError::Device(format!("resampler init failed: {e}")))?;
        // process_into_buffer writes into pre-sized slices.
        let max_out = inner.output_frames_max();
        Ok(Self {
            inner,
            in_bufs: [Vec::new(), Vec::new()],
            out_planar: vec![vec![0.0; max_out], vec![0.0; max_out]],
        })
    }

    /// Feed interleaved stereo input; append resampled interleaved output to `out`.
    pub fn process(&mut self, interleaved: &[f32], out: &mut Vec<f32>) -> AppResult<()> {
        for frame in interleaved.chunks_exact(2) {
            self.in_bufs[0].push(frame[0]);
            self.in_bufs[1].push(frame[1]);
        }
        while self.in_bufs[0].len() >= CHUNK_FRAMES {
            let left: Vec<f32> = self.in_bufs[0].drain(..CHUNK_FRAMES).collect();
            let right: Vec<f32> = self.in_bufs[1].drain(..CHUNK_FRAMES).collect();
            let (_, out_frames) = self
                .inner
                .process_into_buffer(&[left, right], &mut self.out_planar, None)
                .map_err(|e| AppError::Device(format!("resample failed: {e}")))?;
            out.reserve(out_frames * 2);
            for i in 0..out_frames {
                out.push(self.out_planar[0][i]);
                out.push(self.out_planar[1][i]);
            }
        }
        Ok(())
    }

    /// Drain any buffered tail (end of stream) with zero padding.
    pub fn flush(&mut self, out: &mut Vec<f32>) -> AppResult<()> {
        if self.in_bufs[0].is_empty() {
            return Ok(());
        }
        self.in_bufs[0].resize(CHUNK_FRAMES, 0.0);
        self.in_bufs[1].resize(CHUNK_FRAMES, 0.0);
        let left: Vec<f32> = self.in_bufs[0].drain(..).collect();
        let right: Vec<f32> = self.in_bufs[1].drain(..).collect();
        let (_, out_frames) = self
            .inner
            .process_into_buffer(&[left, right], &mut self.out_planar, None)
            .map_err(|e| AppError::Device(format!("resample flush failed: {e}")))?;
        out.reserve(out_frames * 2);
        for i in 0..out_frames {
            out.push(self.out_planar[0][i]);
            out.push(self.out_planar[1][i]);
        }
        Ok(())
    }

    pub fn reset(&mut self) {
        self.in_bufs[0].clear();
        self.in_bufs[1].clear();
        self.inner.reset();
    }
}
