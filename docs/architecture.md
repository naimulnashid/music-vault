# MusicVault — Architecture

Three clients, one account, one music library.

```
                Supabase (PostgreSQL + Auth + Realtime + Edge Functions)
                track details, playlists, ratings, favorites,
                play events, settings, sync state; `vault` function
                     ▲            ▲            ▲
                     │            │            │
   ┌─────────────────┴──┐  ┌──────┴───────┐  ┌─┴──────────────┐
   │ Desktop (SQLite)   │  │ Android(Room)│  │ Web (IndexedDB)│
   │ Tauri 2 + Rust     │  │ Compose+Media3│ │ Next.js 16     │
   └─────────┬──────────┘  └──────┬───────┘  └─┬──────────────┘
             │  pre-signed URLs   │            │
             ▼                    ▼            ▼
        Cloudflare R2 "musicvault" bucket (the vault)
        users/<uid>/audio/<blake3>.<ext> · users/<uid>/art/<sha256>.jpg
        (uploaded by hand; downloaded once, then played locally)
```

## Principles

1. **Offline-first.** Every client works fully offline; cloud state is a sync
   target, not a dependency. Pending changes queue in a persisted outbox.
2. **Audio never streams twice.** Pressing Play on a track that isn't on the
   device downloads it into the cache; every later play uses the local copy.
3. **Supabase stores the details, the vault stores the bytes.** Every track's
   title, artist, album, genre, language, year, lyrics, cover and the rest
   live in its Supabase row and are edited online from any app; a file's
   tags only pre-fill the upload form. R2 holds audio and covers, never
   reached directly: clients get short-lived pre-signed URLs from the
   `vault` Edge Function.
4. **Replaceable components.** UI ↔ business logic ↔ storage ↔ playback ↔
   networking are separated per client; the desktop audio output sits behind a
   trait so WASAPI-Exclusive/ASIO can slot in later.

## Repository layout

| Path | What |
|---|---|
| `apps/desktop` | Tauri 2 + React 19 + TS + Tailwind, Rust backend (Symphonia → 10-band EQ → cpal/WASAPI, lofty tag scan, rusqlite) |
| `apps/android` | Kotlin + Jetpack Compose + Media3 (dual-ExoPlayer gapless/crossfade) + Room |
| `apps/web` | Next.js 16 App Router on Vercel (added in Phase 5) |
| `packages/core` | Shared TypeScript: types, sync engine, vault client, upload model, editable-field rules, LRC parser, smart-playlist and stats engines — consumed by desktop and web |
| `supabase/` | SQL migrations + RLS policies, and the `vault` Edge Function (`functions/vault/`) |
| `docs/` | This document, sync protocol, setup guides |

Android cannot consume TypeScript; shared logic is ported 1:1 to Kotlin
(`apps/android/.../domain/`) and both implementations are validated against the
same golden-test fixtures (Phase 2).

## Smart playlists (rule-based, Phase 2)

Custom smart playlists are a JSON rule AST — nested AND/OR groups of
field/op/value conditions plus optional sort and limit — defined in
`packages/core/src/smartRules.ts` and ported to
`apps/android/.../domain/SmartRules.kt`. The JSON is stored verbatim in each
client's playlist table (`smart_rules` / `smartRules` column) and later syncs
through Supabase `playlists.smart_rules`. Both engines are verified against
`docs/fixtures/smart-rules.golden.json`; change semantics in lockstep or not
at all. Evaluation input is platform-neutral (`RuleTrackInput`): duration in
seconds, timestamps in epoch ms, rating 0 = unrated.

## Track identity (cross-device)

A track is its audio: the **BLAKE3 hash** of the file is its identity
everywhere. The Supabase `tracks` row (unique per user and hash) has the
canonical id; desktop and Android show the track as `vault:<hash>`, the web
uses the row id directly. Uploading a file whose hash is already known
attaches to the existing row — its history is kept, and a track deleted from
the vault is revived rather than duplicated.

## The vault (audio and covers)

- **Storage**: one private R2 bucket. Audio at `users/<uid>/audio/<blake3>.<ext>`,
  covers as a square JPEG plus a 256 px thumbnail at
  `users/<uid>/art/<sha256>.jpg` / `.thumb.jpg`. Objects are immutable — a
  name is a content hash — so a cached copy can never go stale.
- **Access**: the `vault` Edge Function (Supabase, user JWT required) signs
  short-lived GET/PUT URLs for the caller's own keys, commits finished
  uploads, and deletes tracks. Bytes go straight between the device and R2.
- **Upload** (any client, by hand): hash → `resolve_upload_target` (known
  hash → that row) → cover upload → row insert (or an edit of the known row)
  → signed PUT → commit, which records `storage_key` and revives a deleted
  row. Edits to a known row are sent after the commit.
- **Details** are edited with the `track.edit` sync op: field-level
  last-writer-wins on `field_edited_at` (`apply_track_edit` on the server,
  `applyTrackEdit` / `TrackEdit` on the clients, pinned by
  `docs/fixtures/track-edit.golden.json`). Technical facts (duration, codec,
  sample rate, bit depth, channels, size, ReplayGain, hash) are read-only.
- **Delete from vault** (any client): `delete_track` tombstones the row
  (`deleted_at`, hash kept) and removes its favorites, ratings, playlist
  entries and play events; the function deletes the audio and any cover no
  other track uses. Rows are never hard-deleted, so cursor pulls see the
  deletion; every client then drops its cached or pinned copy.
- **Downloads** are verified: the bytes must hash to the track's BLAKE3.

Setup: [vault-setup.md](vault-setup.md). History of the move from Google
Drive: [drive-to-r2-migration.md](drive-to-r2-migration.md).

## Sync model

- `play_events` are append-only — no conflicts by construction.
- Favorites / ratings / settings: last-writer-wins on `updated_at`.
- Playlist ordering: fractional indexes, so concurrent reorders merge.
- Every mutation gets a client-generated UUID → idempotent replay after
  offline periods. Outbox persists in the local DB and survives crashes.
- Supabase Realtime pushes changes to running clients.

Full protocol: [sync-protocol.md](sync-protocol.md) (written in Phase 4).

## Statistics (Phase 7)

Statistics derive entirely from the append-only play-event stream — there is
no play-count column anywhere. Each client records every listening session
(>= 1s) in full to a device-local log (desktop: SQLite `play_events`; web:
IndexedDB `mv-stats`; Android: Room `play_events`) that works signed-out and
deliberately survives sign-out. Tracks with sync identity also enqueue a
`playEvent.add` op under the *same* event id; the copy pulled back into the
sync shadow dedupes against the local row, and other devices' events arrive
the same way, so every client converges on the full cross-device history.

Aggregation is a pure shared engine — `packages/core/src/stats.ts` and its
1:1 Kotlin port `domain/Stats.kt` — locked in lockstep by
`docs/fixtures/stats.golden.json` (same pattern as smart rules). It computes
range summaries, top tracks/artists/albums/genres by plays or listening time,
day/month/year buckets (charts + calendar heatmap), hour-of-day histograms,
streaks, and the yearly recap, all through a pluggable timezone so results
are deterministic in tests and local-midnight-correct on devices.

## Desktop power features (Phase 8)

- **Windows shell**: system tray (show / play-pause / next / prev / quit; the
  menu reuses the `smtc://control` event channel, so SMTC/media keys and tray
  share one dispatch path) and taskbar jump-list tasks that relaunch the exe
  with `--media-control=<action>`, routed to the running instance by the
  single-instance plugin.
- **Mini player**: a second frameless always-on-top webview (label `mini`)
  boots a remote-control UI from the same bundle; the main window hides but
  keeps running as the "brain" (stores, sync, SMTC, queue). State snapshots
  and commands flow over the `mini://*` Tauri events (`lib/miniBridge.ts`).
- **Theming**: synced `theme` stays dark/light and `accent` may be a preset
  name or a custom `#rrggbb` (web renders it too; Android falls back);
  AMOLED pure-black and follow-OS-theme are device-local settings.
- **ReplayGain**: `replayGainMode` (off/track/album) syncs; the desktop engine
  applies a per-stream linear gain inside `StreamState::pull`, so it is
  per-track-correct across gapless splices and crossfades. Gains are read
  from the file at upload (`replaygain_track_db`/`replaygain_album_db`).
- **Decoders**: `.ape` via the pure-Rust `ape-decoder` crate; `.wv` via
  vendored libwavpack C sources (`src-tauri/vendor/wavpack`, BSD-3) compiled
  by build.rs with hand-written minimal FFI — no CMake/bindgen needed.

## Cache & downloads (two tiers)

1. **Auto-cache** — filled by playing a track; LRU-evicted under a
   configurable size cap.
2. **Pinned downloads** — explicit song/album/artist/playlist downloads;
   never auto-evicted.

Play resolution: pinned download → cache → download-then-play from a
pre-signed URL. Desktop keeps both tiers in its SQLite cache index
(`vault:<hash>` keys), Android in Room `downloads` + Media3's SimpleCache,
the web in OPFS with IndexedDB bookkeeping.

## Hardening & release (Phase 9)

- **Tests**: core vitest (sync conflict suite, smart rules, stats, LRC,
  fractional keys — golden fixtures shared with the Kotlin ports), Rust
  engine/decoder/DB/cache-LRU tests, Android JVM ports of the conflict suite,
  Playwright web e2e (smoke always; signed-in flows behind `E2E_EMAIL`/`E2E_PASSWORD`).
- **Diagnostics**: both sync engines emit breadcrumbs (see
  [sync-protocol.md](sync-protocol.md) § Diagnostics) into the desktop appdata
  log / logcat / browser console; Rust `setup done` and renderer
  `[startup]` lines profile startup.
- **Performance**: `TrackList` windows its fixed-height rows via
  `useVirtualRows` (desktop + web 1:1); every vault cover has a 256 px
  thumbnail made at upload, used by list rows and grids; heavy web views
  (stats, recap, downloads, EQ, visualizer) are lazy chunks.
- **CI/CD**: `ci.yml` runs every suite per push/PR; `release.yml` builds the
  NSIS installer + APK on tags/dispatch. Vercel handles web previews.

## Build phases

See [../PLAN.md](../PLAN.md) for the phase-by-phase plan (P0 bootstrap →
P9 release hardening), then [drive-to-r2-migration.md](drive-to-r2-migration.md)
for the move from Google Drive to the vault.
