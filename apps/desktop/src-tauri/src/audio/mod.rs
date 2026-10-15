mod analyzer;
mod decoder;
mod engine;
mod eq;
mod events;
mod output;
mod resampler;
mod wv;

use crossbeam_channel::Sender;
use tauri::AppHandle;

/// Commands accepted by the engine thread. Tauri commands are thin wrappers
/// that push these onto the channel; all audio state lives on that thread.
pub enum Cmd {
    Load { path: String, start_at: f64, autoplay: bool, rg_db: Option<f64> },
    PreloadNext { path: Option<String>, rg_db: Option<f64> },
    Play,
    Pause,
    Stop,
    Seek(f64),
    SetVolume(f32),
    SetEq([f32; 10]),
    SetCrossfade(f32),
    SetGapless(bool),
    SetVisualizer(bool),
    /// Live ReplayGain change for the already-playing track (mode switches).
    SetRgGain(Option<f64>),
    Shutdown,
}

#[derive(Clone)]
pub struct EngineHandle {
    tx: Sender<Cmd>,
}

impl EngineHandle {
    pub fn send(&self, cmd: Cmd) {
        if self.tx.send(cmd).is_err() {
            tracing::error!("audio engine channel closed");
        }
    }
}

pub fn spawn_engine(app: AppHandle) -> EngineHandle {
    let (tx, rx) = crossbeam_channel::unbounded();
    std::thread::Builder::new()
        .name("audio-engine".into())
        .spawn(move || engine::Engine::new(app, rx).run())
        .expect("failed to spawn audio engine thread");
    EngineHandle { tx }
}
