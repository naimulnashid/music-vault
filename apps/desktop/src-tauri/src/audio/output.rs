use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::Sender;
use rtrb::{Consumer, Producer, RingBuffer};

use crate::error::{AppError, AppResult};

/// Ring capacity in seconds — the engine's control latency ceiling.
const RING_SECONDS: f64 = 0.15;

/// Internal notifications from the realtime callback back to the engine loop.
pub enum OutputEvent {
    StreamError(String),
}

/// A live WASAPI output stream fed from an SPSC ring buffer.
///
/// The realtime callback only pops samples (wait-free) and zero-fills on
/// underrun; all decode/DSP work happens on the engine thread.
pub struct Output {
    _stream: cpal::Stream,
    pub producer: Producer<f32>,
    pub sample_rate: u32,
    pub device_name: String,
    /// Set to drop everything queued in the ring (seek/track change flush).
    flush: Arc<AtomicBool>,
}

impl Output {
    /// Open the default output device, preferring `desired_rate` when the
    /// device supports it in shared mode; falls back to the device default.
    /// Returns the output plus whether the engine must resample to feed it.
    pub fn open(desired_rate: u32, events: Sender<OutputEvent>) -> AppResult<(Self, bool)> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| AppError::Device("no output device available".into()))?;
        let device_name = device.name().unwrap_or_else(|_| "Unknown Device".into());

        let default_config = device
            .default_output_config()
            .map_err(|e| AppError::Device(format!("no default output config: {e}")))?;

        // Probe whether the device accepts the track's native rate.
        let supports_desired = device
            .supported_output_configs()
            .map(|mut configs| {
                configs.any(|c| {
                    c.channels() >= 2
                        && c.min_sample_rate().0 <= desired_rate
                        && c.max_sample_rate().0 >= desired_rate
                        && c.sample_format() == cpal::SampleFormat::F32
                })
            })
            .unwrap_or(false);

        let sample_rate = if supports_desired {
            desired_rate
        } else {
            default_config.sample_rate().0
        };
        let channels: u16 = 2;

        let config = cpal::StreamConfig {
            channels,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let capacity = ((sample_rate as f64 * RING_SECONDS) as usize).max(2048) * channels as usize;
        let (producer, mut consumer): (Producer<f32>, Consumer<f32>) =
            RingBuffer::new(capacity);

        let flush = Arc::new(AtomicBool::new(false));
        let cb_flush = flush.clone();
        let err_events = events.clone();

        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    if cb_flush.swap(false, Ordering::AcqRel) {
                        // Discard everything queued before this flush request.
                        while consumer.pop().is_ok() {}
                    }
                    for sample in data.iter_mut() {
                        *sample = consumer.pop().unwrap_or(0.0);
                    }
                },
                move |err| {
                    let _ = err_events.send(OutputEvent::StreamError(err.to_string()));
                },
                None,
            )
            .map_err(|e| AppError::Device(format!("failed to build output stream: {e}")))?;

        stream
            .play()
            .map_err(|e| AppError::Device(format!("failed to start output stream: {e}")))?;

        tracing::info!(
            device = %device_name,
            rate = sample_rate,
            desired = desired_rate,
            resampling = sample_rate != desired_rate,
            "output stream opened"
        );

        Ok((
            Self {
                _stream: stream,
                producer,
                sample_rate,
                device_name,
                flush,
            },
            sample_rate != desired_rate,
        ))
    }

    /// Ask the callback to discard queued audio (snappy seeks/track changes).
    pub fn request_flush(&self) {
        self.flush.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::decoder::{tests::write_test_wav, DecodedStream};

    /// End-to-end device smoke test: decode the 24/96 test tone and push
    /// ~0.4s of it through a real WASAPI stream (audible on the default
    /// device). Verifies the whole decode → ring → callback path.
    #[test]
    fn plays_hires_tone_through_default_device() {
        let (tx, _rx) = crossbeam_channel::unbounded();
        let (mut out, resampling) = Output::open(96_000, tx).expect("open output device");
        println!(
            "device: {} @ {} Hz (resampling: {resampling})",
            out.device_name, out.sample_rate
        );

        let path = write_test_wav(1.0, 96_000);
        let mut dec = DecodedStream::open(path.to_str().unwrap()).expect("open wav");
        let mut buf = Vec::new();
        let mut pushed = 0usize;
        let target = out.sample_rate as usize; // ~0.5s of stereo audio
        while pushed < target {
            buf.clear();
            let got = dec.next_frames(&mut buf, 2048).expect("decode");
            if got == 0 {
                break;
            }
            for &s in &buf {
                while out.producer.push(s).is_err() {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }
            pushed += got;
        }
        assert!(pushed >= target / 2, "pushed {pushed} frames");
        // Let the callback drain the ring before dropping the stream.
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
}
