# MusicVault Cross-Platform — Build Plan

> **Historical.** This is the original v1 plan (2026-07). Its Google Drive design — Drive as the
> audio library, Drive `fileId` identity, local folders and local mode — was replaced in 2026-10 by
> the private R2 vault; see [docs/drive-to-r2-migration.md](docs/drive-to-r2-migration.md) and
> [reports/VAULT.md](reports/VAULT.md). The sections below are kept as written.

## Part 1 — Assessment of the three existing projects

### What exists today

| | Desktop | Android | Web App |
|---|---|---|---|
| Stack | Tauri 2, React 19, TS, Tailwind 4, Rust (Symphonia → EQ → cpal/WASAPI), rusqlite | Kotlin, Compose, Media3/ExoPlayer (dual-player gapless/crossfade), Room, DataStore | Vite SPA, React 19, TS, Tailwind 4, IndexedDB (`idb`), Web Audio |
| Library | Local folders, lofty tags, artwork cache, SQLite | SAF folder import, JAudioTagger, Room | File import into IndexedDB, `music-metadata` |
| Player | Native-rate hi-res playback, gapless + crossfade, 10-band EQ, visualizer | Gapless/crossfade, EQ (DynamicsProcessing), visualizer, Android Auto, lock screen | Web Audio EQ, gapless/crossfade, visualizer, MediaSession |
| Features | Playlists, smart playlists, favorites, LRC lyrics, stats, sleep timer, themes, media keys/SMTC | Same parity + notification/BT controls | Same parity |
| Cloud / accounts | **None** | **None** | **None** |

### Verdict: reuse heavily, do NOT start fresh

The three apps are mature, feature-complete **local** players whose stacks already match the target
stack almost exactly (Tauri 2 + React + Rust; Kotlin + Compose + Media3 + Room). Rebuilding the
Rust audio engine or the Android playback service from scratch would throw away the hardest,
highest-quality work.

**Reuse per project:**

- **Desktop → reuse ~85%.** Entire Rust backend (`audio/`, `scan/`, `db/`, `smtc.rs`, `commands/`),
  entire React UI, stores, hooks. Extend with: Supabase auth/sync, Google Drive source + cache,
  ratings, richer metadata, play events, mini player/tray/jump lists, AMOLED/custom accents,
  ReplayGain.
- **Android → reuse ~85%.** Clean architecture already in place (`domain/ data/ playback/ ui/`).
  Extend with the same cloud layer (Kotlin implementations).
- **Web app → reuse the React components and `lib/` logic (~50%), but rebuild the shell.**
  It is a Vite SPA; the target is Next.js 16 App Router on Vercel. Components, stores, smart
  playlist engine, LRC parser, and formatting port over; routing, data layer, and auth are new.

**What must be built new (exists nowhere):**

1. Supabase project: auth, profiles, playlists, favorites, ratings, play events, settings, queue sync + RLS.
2. Google Drive integration: OAuth, scan, incremental change detection, download, hybrid play-through-cache.
3. Cross-device **track identity** (today desktop uses absolute file path as track ID — useless across devices).
4. Sync engine with offline queue + conflict resolution.
5. Cache manager (LRU auto-cache + permanent pinned downloads).
6. Next.js 16 website with server-side auth and browser-storage offline playback.
7. Statistics 2.0 (append-only play events → charts, heatmaps, streaks, yearly recap).
8. Metadata upgrades: album artist, track/disc number, composer, BPM, ReplayGain, rating.

---

## Part 2 — Target architecture

### Repository layout (this folder)

```
Music Vault - Cross Platform/
├── apps/
│   ├── desktop/          # from Music Vault Desktop (Tauri 2 + React + Rust)
│   ├── android/          # from Music Vault Android (Kotlin + Compose)
│   └── web/              # NEW Next.js 16 App Router, deployed on Vercel
├── packages/
│   └── core/             # shared TypeScript: types, sync engine, Supabase client,
│                         # Drive client, smart-playlist rule engine, LRC, formatting
├── supabase/
│   ├── migrations/       # SQL schema + RLS policies
│   └── seed.sql
├── docs/                 # architecture, sync protocol, Drive layout, setup
└── package.json          # npm workspaces: apps/desktop, apps/web, packages/core
```

Desktop and web consume `packages/core` directly. Android cannot consume TS, so the **sync
protocol and schema are documented in `docs/sync-protocol.md`** and ported to Kotlin (the Android
app already ports web `lib/` logic 1:1 — same approach).

### Data topology

```
                Supabase (PostgreSQL + Auth + Realtime)
                metadata, playlists, ratings, favorites,
                play events, settings, sync state
                     ▲            ▲            ▲
                     │            │            │
   ┌─────────────────┴──┐  ┌──────┴───────┐  ┌─┴──────────────┐
   │ Desktop (SQLite)   │  │ Android(Room)│  │ Web (IndexedDB)│
   └─────────┬──────────┘  └──────┬───────┘  └─┬──────────────┘
             │                    │            │
             ▼                    ▼            ▼
        Google Drive  ── "Music Vault/<Language>/<Song>.flac" (master audio library)
        + local folders (desktop)          downloads → local cache, never re-streamed
```

### Track identity (critical design decision)

A track must have one ID across all devices. Rules:

- **Drive tracks:** primary key = Google Drive `fileId` (stable, survives renames/moves).
- **Local-only tracks (desktop folders):** key = content hash (BLAKE3 of audio stream).
- Supabase `tracks` table stores `id (uuid)`, `drive_file_id`, `content_hash`, and all metadata.
  Clients resolve local files → canonical track ID via drive_file_id or hash.
- The same song in Drive **and** a local folder resolves to one track (hash match) so ratings,
  favorites, and stats never split.

### Supabase schema (all tables RLS: `user_id = auth.uid()`)

- `profiles` — user profile, display name.
- `tracks` — canonical metadata index (title, artist, album, album_artist, genre, year, duration,
  track_no, disc_no, composer, bpm, replaygain_track/album, codec, sample_rate, bit_depth,
  drive_file_id, drive_md5, content_hash, size, updated_at).
- `playlists` — id, name, parent_folder_id (nested folders), is_smart, smart_rules (jsonb), sort.
- `playlist_items` — playlist_id, track_id, position (fractional index for cheap reordering).
- `favorites` — (user_id, track_id, created_at).
- `ratings` — (user_id, track_id, rating 1–5, updated_at).
- `play_events` — append-only: id, track_id, device_id, played_at, duration_played, completed.
- `devices` — device registry (name, platform, last_seen).
- `settings` — jsonb per user + per device, updated_at per key.
- `queue_state` — serialized queue + position per user (last writer wins).
- `sync_log` / cursors as needed for incremental pull.

**Conflict resolution:** play_events are append-only (no conflicts). Favorites/ratings/settings:
last-writer-wins on `updated_at`. Playlists: LWW per row + fractional-index positions so
concurrent reorders merge without rewriting whole lists. Every client keeps a local
`pending_ops` outbox; ops are idempotent (client-generated UUIDs) and flushed when online.

### Google Drive integration

- OAuth 2.0 with `drive.readonly` (or `drive.file` if the app should also upload), PKCE flow with
  loopback redirect on desktop, Google Sign-In on Android, server-side OAuth on web. Tokens in OS
  keychain / EncryptedSharedPreferences / encrypted Supabase-side for web.
- Initial scan: `files.list` under the "Music Vault" folder → build index (id, name, md5, size, path).
- Incremental: `changes.list` with saved `startPageToken` — cheap update detection.
- **Metadata is extracted once** (first device to download a file parses tags and writes them to
  Supabase `tracks`), so other devices see full metadata without downloading. Fallback: filename +
  folder parsing until first download.
- Download = `files.get?alt=media` with resumable ranges → temp file → verify md5 → move into cache.

### Cache & offline downloads (all clients, same model)

Two tiers, tracked in the local DB:

1. **Auto-cache** — created by pressing Play on a non-local track. LRU eviction under a
   configurable size cap. Never evicts tier 2.
2. **Pinned downloads** — user explicitly downloads song/album/artist/playlist. Permanent until
   the user removes them.

Play resolution order: local folder file → pinned download → cache → download-then-play
(progressive: start playback as soon as enough of the file is buffered, keep writing to cache;
file is never re-downloaded once complete).

Storage per platform: desktop `%APPDATA%` cache dir + SQLite; Android app-private storage + Room
(+ WorkManager for battery-friendly batch downloads); web OPFS via IndexedDB bookkeeping.

### Audio engine abstraction

Interface (already effectively exists on desktop): `play/pause/seek/setVolume/next/previous`,
gapless arm, crossfade, EQ, events. Implementations:

- Desktop: existing Rust engine (Symphonia → EQ → cpal shared WASAPI). Add ReplayGain stage.
  The trait boundary in `audio/output.rs` is where WASAPI-Exclusive/ASIO backends slot in later.
- Android: existing dual-ExoPlayer `VaultPlayer`.
- Web: existing Web Audio engine.

Add formats on desktop: Symphonia covers MP3/FLAC/WAV/AAC/OGG/OPUS/ALAC/AIFF; APE/WavPack via
additional decoder crates behind the same decoder trait.

---

## Part 3 — Step-by-step build phases

### Phase 0 — Workspace bootstrap
1. `git init`; create monorepo layout above; npm workspaces root.
2. Copy Desktop → `apps/desktop`, Android → `apps/android` (originals untouched).
3. Create `packages/core` (tsconfig strict, ESLint+Prettier, vitest); wire desktop to consume it.
4. Move duplicated desktop/web TS (`types`, `lrc.ts`, `smartPlaylists.ts`, `albums.ts`,
   `format.ts`) into `core`.
5. Verify: `apps/desktop` builds & runs (`npm run tauri dev`), `apps/android` assembles.
6. Write `docs/architecture.md`; root README.

### Phase 1 — Supabase foundation
1. Create Supabase project; write `supabase/migrations/0001_init.sql` with the schema above + RLS.
2. `packages/core/supabase`: typed client, generated DB types, auth helpers.
3. Desktop: sign in/up UI (email + password; magic link optional), session persistence, account
   screen, device registration. App remains fully usable signed-out (local mode).
4. Android: same via supabase-kt.
5. Tests: RLS policy tests (one user cannot read another's rows).

### Phase 2 — Metadata & track-identity upgrade
1. Extend `Track` model everywhere: album_artist, track_no, disc_no, composer, bpm,
   replaygain_track/album, rating; migrations for desktop SQLite + Android Room.
2. Desktop Rust: lofty already reads most tags — extract the new fields + ReplayGain; add BLAKE3
   content hashing on scan (background, incremental).
3. Ratings: 1–5 stars in track lists, now playing, context menus (all clients).
4. Smart playlist engine (`core`): rule AST — field/op/value with AND/OR groups (Rating ≥ 4,
   Genre = Rock, Play Count > 20, Never Played, Last Played before X, Year range…), rule builder UI.
5. Port the same rules to Kotlin; share golden-test fixtures (JSON in `docs/`) so TS and Kotlin
   engines are verified against identical cases.

### Phase 3 — Google Drive on desktop (the core new capability)
1. Google Cloud project; enable Drive API; OAuth desktop-client credentials.
2. Rust: PKCE loopback OAuth flow; tokens in Windows Credential Manager; refresh handling.
3. Drive scanner: full scan of "Music Vault/" → `drive_files` table; `changes.list` incremental
   updates on startup + periodic.
4. Merge Drive index into library: Drive-only tracks appear in the library (metadata from
   Supabase if another device indexed them, else filename-derived) with a cloud badge.
5. Cache manager (Rust): the two-tier model, LRU eviction, size setting, integrity (md5) checks.
6. Hybrid playback: play-resolution chain + progressive download-then-play; download progress UI.
7. Explicit downloads: song/album/artist/playlist "Download" actions, Downloads view, remove.
8. First-download metadata extraction → push tags/artwork to Supabase `tracks`.

### Phase 4 — Sync engine (desktop first)
1. `core/sync`: outbox (pending ops), pull cursors, LWW merge, fractional-index list ordering.
2. Sync favorites, ratings, playlists (+nested folders), settings, queue, play events.
3. Supabase Realtime subscription for near-instant cross-device updates while running.
4. Offline mode: everything queues locally; reconnect flushes; **no data loss** — outbox is
   persisted in SQLite and survives crashes.
5. Tests: conflict simulations (two devices edit same playlist offline), idempotent replay.

### Phase 5 — Web app (Next.js 16 rewrite, reusing React components)
1. Scaffold `apps/web`: Next.js 16 App Router, TS strict, Tailwind, Vercel config.
2. Supabase SSR auth (`@supabase/ssr`), protected routes, account settings page.
3. Port components/stores from the old web app into the new shell; data now comes from
   Supabase (`core`), not local IndexedDB imports.
4. Views: library browse (artists/albums/songs/genres/years), search, playlist editing
   (drag-and-drop, smart rules), favorites, ratings, recently played, statistics, docs pages.
5. Playback: Web Audio engine from old app + Drive download → OPFS temporary offline cache
   (browser-permitting), same two-tier bookkeeping in IndexedDB.
6. Deploy to Vercel; wire OAuth redirect URIs.

### Phase 6 — Android cloud parity
1. Supabase auth (done in P1) + Kotlin sync engine port (protocol from `docs/sync-protocol.md`).
2. Google Sign-In + Drive REST: scan, changes, downloads via WorkManager (Wi-Fi-only option,
   charging-only option, battery-aware).
3. Cache manager in Room + app-private storage; Downloads screen; hybrid play resolution in
   `VaultPlayer` data-source layer.
4. Ratings UI, new metadata fields, smart-rule builder.
5. Material You dynamic color + AMOLED theme.

### Phase 7 — Statistics 2.0 (all clients)
1. Record full play events locally (track, device, started_at, duration_played, completed) —
   replace/augment existing play-history stores; sync as append-only stream.
2. Charts: top artists/albums/songs by range, listening time, daily/monthly/yearly charts,
   calendar heatmap, streaks.
3. Yearly "Wrapped"-style recap view (web + desktop).
4. Aggregations computed client-side from events; heavy rollups later via Postgres views if needed.

### Phase 8 — Desktop polish & power features
1. Mini player window + multiple-window support (Tauri multiwindow).
2. Tray icon with controls; Windows jump lists; keep SMTC/media keys.
3. AMOLED theme + custom accent color picker (replaces fixed 4-accent set); system theme follow.
4. ReplayGain playback stage (track/album mode) in the Rust engine; APE + WavPack decoders.
5. Folder watching (notify crate) for live local-library updates; duplicate detection
   (content hash from P2 makes this trivial).
6. Keep: gapless, crossfade, EQ, visualizer, lyrics, sleep timer — already done.

### Phase 9 — Hardening & release
1. Test pass: `core` unit tests (sync merge, smart rules, LRC), Rust engine/cache tests,
   Android unit + instrumented tests, web e2e (Playwright) for auth/browse/playlist flows.
2. Error handling & logging audit (desktop already logs to appdata; add breadcrumbs to sync).
3. Performance: virtualized lists for 50k+ track libraries, artwork thumbnail pipeline,
   lazy route loading on web, startup profiling.
4. CI (GitHub Actions): lint + typecheck + tests per app; Tauri NSIS installer build; APK build;
   Vercel deploy previews.
5. Docs: setup guide (Supabase env, Google OAuth setup), sync protocol, user docs on the website.

### Future (explicitly out of scope for v1)
- WASAPI Exclusive / ASIO output backends (slot into the existing output trait).
- Multiple users / library sharing.
- Additional storage providers behind the Drive client interface.

---

## Suggested order of attack & milestones

1. **M1 (P0–P1):** monorepo runs, sign-in works on desktop — nothing user-visible breaks.
2. **M2 (P2–P3):** desktop plays your Drive library through the cache — the core promise works.
3. **M3 (P4):** two desktop installs stay in sync.
4. **M4 (P5):** website live on Vercel with browse/playlists/stats.
5. **M5 (P6):** Android full parity — the ecosystem is complete.
6. **M6 (P7–P9):** stats, polish, release quality.
