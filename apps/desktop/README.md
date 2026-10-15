# Music Vault Desktop

Native Windows desktop version of the Music Vault music player. The UI is the
original React + TypeScript app; audio runs through a native Rust engine
(Symphonia → 10-band EQ → WASAPI via cpal) so playback happens at the track's
native sample rate — including hi-res material (24-bit / 96 kHz and above) —
with no browser resampling.

## Architecture

```
┌─────────────────────────────────────────────┐
│ WebView (React 19 + TypeScript + Tailwind)  │
│  stores (zustand) · views · shortcuts       │
└──────────────┬──────────────────────────────┘
               │ Tauri IPC (commands + events)
┌──────────────┴──────────────────────────────┐
│ Rust backend (src-tauri)                    │
│  audio/   Symphonia decode · gapless splice │
│           crossfade · biquad EQ · rustfft   │
│           cpal/WASAPI output                │
│  vault/   upload prep: lofty, BLAKE3, art   │
│           R2 transfers · two-tier cache     │
│  db/      SQLite (rusqlite, WAL)            │
│  smtc.rs  Windows media keys / flyout       │
└─────────────────────────────────────────────┘
```

- **Library**: the songs in your vault — a private Cloudflare R2 bucket — as
  synced from Supabase; sign-in is required. Add songs with **Upload** (files,
  folders, or drag-and-drop onto the window); details and covers are edited
  online. A track plays from the local cache or pinned download, or is
  downloaded once (BLAKE3-verified) into the cache under
  `%APPDATA%\com.naimul.music-vault\`. See `../../reports/VAULT.md`.
- **Gapless & crossfade** are spliced sample-accurately inside the engine's
  mixer thread; the frontend only arms the next track ~15 s before the end.
- **Sample rates**: the output stream is opened at the track's native rate
  when the device supports it; otherwise the engine resamples (rubato sinc).
- **Logs**: `%APPDATA%\com.naimul.music-vault\logs\`.

## Development

Prerequisites: Node 20.19+ or 22.12+, Rust (stable, MSVC), WebView2 runtime.

```sh
npm install
npm run tauri dev      # dev app with hot reload
npm run tauri build    # NSIS installer in src-tauri/target/release/bundle
npm run lint           # oxlint
```

## Keyboard shortcuts

Space play/pause · ←/→ seek ±5 s · Shift+←/→ prev/next · ↑/↓ volume ·
M mute · S shuffle · R repeat · F favorite

## Feature parity with the web app

All Tracks / Albums / Artist views, search + sort, playlists (create, rename,
delete, drag reorder), smart playlists, queue panel, favorites, synced LRC
lyrics, 10-band EQ with presets, gapless + crossfade, spectrum/waveform
visualizer, listening statistics, sleep timer, light/dark/system themes with
AMOLED, resume playback — plus native additions: folder upload, OS
drag-and-drop upload, Windows media-key/flyout integration, and native
notifications.
