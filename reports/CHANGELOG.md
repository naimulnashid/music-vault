# Changelog

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; the vault migration entry added 2026-10-13.
> **Generated from commit history** (45 commits, 2026-07-14 → 2026-07-17, single branch, no merges,
> then the vault migration, 2026-10-11 → 13).
> The repository ships no changelog and no version tags; the version `1.0.0` is read from
> [package.json](../package.json), [Cargo.toml](../apps/desktop/src-tauri/Cargo.toml) and
> [tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json) (Android: `versionName "1.0"`,
> `versionCode 1`).
> Entries are grouped by release and theme rather than one line per commit.
> Format follows [Keep a Changelog](https://keepachangelog.com/) conventions.

---

## [Unreleased] — owner feedback batch (2026-10-15)

### Added
- Public source repository `naimulnashid/music-vault`, a squashed export of this one, with
  LICENSE (MIT), SECURITY.md, CONTRIBUTING.md, a "Run your own" README section and a social
  preview. Releases there are source only: every build carries the Supabase project it was
  built for.

### Changed
- Android launcher icon now matches the desktop and web icon (violet gradient tile, white notes).
- Docs and reports brought up to date with the 2026-10-13 to 2026-10-15 changes: removed features
  (star ratings, the accent picker, Duplicates, Android's drawer) no longer appear as current, test
  counts were recounted, and the new download, cache, statistics and UI features are documented.
- A downloaded song is marked with a tick instead of a down arrow (all apps).
- Statistics heatmap covers the last 6 months (was 12), with month and weekday labels; cells grow
  on hover (desktop/web) or tap (Android). The Yearly recap button lost its sparkle icon.
- Upload: every song shows all its detail fields straight away; the "More details" toggle is gone.
- Album / artist / playlist Download button: shows how many songs are done and left while it runs;
  tapping it then cancels (queued and in-flight downloads stop), and once everything is downloaded a
  tap removes the downloads (all apps).
- Auto-cache limit is now Off, 1, 2, 5 or 10 GB (10 GB at most; Off keeps only the song playing and
  the next one), and the Downloads page has a Clear cache button (all apps; Android gained the
  auto-cache controls and applies a new limit without a restart).
- Player bar (desktop/web): a click anywhere on it outside the controls opens the full player; Lyrics
  (microphone), Sound (vertical sliders), Queue and Clear queue (broom) have distinct icons, and the
  bar's icons are a little larger. Android's full player uses the same distinct Sound and Clear
  queue icons.
- Every chart (activity, listening clock, heatmap, recap months) shares one hover tooltip, styled like
  the seek bar's: a dark surface in dark mode and a light one in light mode (desktop/web).
- Web: the account menu no longer has an "Account settings" item.
- Web: the address bar follows the page (/albums, /album/…, /artist/…, /playlist/…, /stats,
  /stats/history, /downloads…); reloading or sharing a link opens that page, and the browser's
  Back/Forward match the app's Back button.
- Playlist tiles show a bracketed qualifier's initial too: "Bangla (Bangladesh)" → B(B),
  "Bangla (India)" → B(I) (desktop/web).
- Android: the account menu drops down under the avatar at the top right, laid out like the desktop
  one (account, sync status with Sync now, Upload, appearance, Sign out) instead of a bottom sheet.
- Web: installable as an app (PWA): a manifest with regular and maskable icons, a service worker
  that keeps the app shell and build files so the installed app opens offline, and an
  "Install app" item in the account menu when the browser offers it.
- Android: a volume button at the right of the full player's second row opens a vertical slider
  that shows the percentage while you drag.
- Android: signed release APK. The key lives outside the repo; `local.properties` points at it
  (`signing.properties=…`), and without that line a release build comes out unsigned. Release
  builds no longer run R8.
- Release builds (`release.yml`) run only when started by hand; releases with installers are built
  locally and attached to the private repo's release, so a pushed tag no longer triggers CI builds
  that would replace them.
- Android: the upload page has one back arrow, with "Upload to your vault" in the top bar, and a
  larger "Add files" button in the middle of the empty page (centered above the list once files
  are added).
- Android: the Listening Activity chart's dates read 09-16, 09-23… again (they wrapped after the
  hyphen and showed only the month), and month ranges label every month, as on desktop/web.
- Android: heatmap month labels no longer run into the squares, and squares no longer grow on tap.
- Android: playlist covers in Collections (and a playlist's header) are a 2×2 mosaic of four
  distinct song covers, as on desktop/web; smart playlists use the songs their rules match.
- Collapsed sidebar (desktop/web) lists your playlists under the main icons; playlists without a
  cover show the first letter of their name instead of the sparkle icon.

### Added
- Statistics heatmap → Expand opens Listening History: every listening day since the first year
  with plays, in 6-month blocks on one colour scale (all apps).
- Web: "Download all songs automatically" too (while the site is open).
- Windows and Android: "Download all songs automatically" keeps every vault song on the device; songs
  added later download on their own, songs deleted from the vault are removed, and the auto-cache is
  bypassed while it is on.

## [Unreleased] — new look and playback fixes (2026-10-13)

### Changed
- **Redesign of all three apps** (inspired by modern streaming apps): dark-first design tokens, one
  accent (Vibrant Violet `#8B5CF6`; accent presets and Material You accent removed), the Figtree
  typeface, and smooth transitions (Motion on desktop/web, Compose animations on Android).
- Desktop + web (same components): top bar with one search (songs, albums, artists; Ctrl+K or /)
  and Back; sidebar with collapsible icon rail and playlist covers; player bar with a seek line on
  its top edge; full-window Now Playing with a colour wash from the artwork and Up next / Lyrics /
  Details tabs; one song menu (row ⋮, right-click, player bar) with Play next / Add to queue;
  hero headers on album, artist, playlist and smart pages; card grids for By Genre/Year/Language;
  theme (Light/Dark/System, AMOLED) and notifications moved into the account menu.
- Android: bottom navigation (Library, Collections, Downloads, Stats) instead of the drawer;
  floating mini player (swipe left/right to change song, swipe up to open); full player with
  artwork pager (swipe to change song), drag down to close, swipe up for Up next / Lyrics;
  bottom-sheet song menu; collection headers; settings sheet (theme, AMOLED, account, upload).

### Added
- Android: live download progress — rings on song rows, overall and per-song bars on Downloads,
  and a progress notification; changing Wi-Fi/charging options re-queues waiting downloads.
- Desktop/web: download rings on song rows; "Play next" / "Add to queue" everywhere.
- Desktop: closing the window keeps Music Vault running in the tray (first time it says so);
  tray → Quit exits.

### Fixed
- Android: playback no longer stops on the lock screen, and the next song starts on its own —
  the media session is now registered with the playback service (media notification, lock-screen
  and headset controls, foreground service) and playback holds a Wi-Fi lock.
- Lyrics saved as LRC text in the plain-lyrics field now display synced instead of showing raw
  timestamps.

## [Unreleased] — song details and fixes (2026-10-13)

### Removed
- **Star ratings** on all three apps (rows, Now Playing, menus) and the Rating field of the
  smart-rule builder; saved rules naming it count it as never set (golden fixture updated). The
  ratings table and sync pull path stay for older builds.

### Changed
- Song details: **Country** added after Language; **Year** replaced by **Release date** ("2019",
  "2019-05" or "2019-05-14"; `year` now follows it). Album artist, track number, disc number,
  composer and BPM are no longer edited, uploaded or shown. Supabase migration
  [0006_release_date_country.sql](../supabase/migrations/0006_release_date_country.sql).
- Desktop/web form fields no longer show a drop-down arrow, except Language and Country.
- Smart playlist rules: Album Artist, Composer, BPM, Track # and Disc # removed; **Country** added.
  A saved rule on a retired field counts it as never set (no crash).

### Added
- Android: a **Download** button on playlists (pins every track not yet on the device).

### Fixed
- Desktop/web smart playlist rules: typing in a value box no longer drops or reverts characters
  (edits are kept locally and saved after a short pause).

## [Unreleased] — the vault (2026-10-11 → 2026-10-13)

Google Drive, local-folder libraries and local mode replaced by a private Cloudflare R2 vault —
steps M0–M8 of [docs/drive-to-r2-migration.md](../docs/drive-to-r2-migration.md). No version bump.

### Added
- **The vault**: a private R2 bucket (`users/<uid>/audio/<blake3>.<ext>`, covers by SHA-256 with a
  256 px thumbnail) and the **`vault` Edge Function** — `sign-get`, `sign-put`, `commit`, `delete`
  (`adb3772`). Setup guide [docs/vault-setup.md](../docs/vault-setup.md) (`589df7e`).
- **Supabase migration 0004**: vault columns on `tracks` (`storage_key`, `uploaded_at`,
  `artwork_key`, `field_edited_at`, `deleted_at`, `merged_into`), the protected-column trigger,
  and `apply_track_edit`, `resolve_upload_target`, `merge_tracks`, `delete_track` (`adb3772`).
- **Uploads from all three apps** — desktop files/folders/drag-and-drop (`5f95abd`), web picker and
  drag-and-drop (`d89476e`), Android picker and Share → Music Vault (`eda4cc8`) — with a review form,
  batch fields and a shared cover; known files are recognized by hash.
- **Details and covers edited online** from every app: the `track.edit` sync op with field-level
  last-writer-wins, pinned in SQL, TypeScript and Kotlin by `track-edit.golden.json` (`85cb73a`).
- **Delete from vault** from every app, behind a confirmation (`5f95abd`, `f935cf0`, `d89476e`,
  `eda4cc8`).
- **Verified downloads**: every download is checked against the track's BLAKE3; Android pinned
  downloads from the vault (`363b596`).

### Changed
- **The library is the vault** on every client: a projection of the synced `tracks` rows
  (`projectVault`, `projectRows`, `VaultMerge`) with ids `vault:<hash>` (desktop, Android).
- **Track identity is the content hash alone** — migration 0005 drops `drive_file_id` /
  `drive_md5` (`3799939`).
- **Fresh start**: the server was wiped and each client's library reset — desktop SQLite **v9**,
  Room **v7**, the web's `freshStart`; device settings kept (`d6f4d2e`, `bd3aaf6`, `6f2ad62`).
- An account is required; builds without Supabase values say so.

### Removed
- Google Drive on every client (OAuth, scanner, merge, `/api/drive/*`, token storage) and its
  environment variables and secrets; local-folder import and watching; the duplicates view; local
  mode (`bd3aaf6`, `6f2ad62`, `3799939`).

### Fixed
- Re-uploading a deleted track keeps the form's edits (applied after the commit revives the row),
  and downloaded copies of deleted tracks are removed (`5cc4888`).
- Android: startup crash when WorkManager was touched during Hilt injection (`6f2ad62`).

### Documentation
- Guides and reports rewritten for the vault; [VAULT.md](VAULT.md) replaces the Google Drive report
  and `docs/google-drive-setup.md` (M8, `9523e8d` …).

---

## [Unreleased] — post-1.0

Work after the final phase commit (`36e11d8`, 2026-07-17). All of it lands on 2026-07-17.
No version bump accompanies these changes.

### Added
- **Desktop — "Sync to this device"**: mirrors Drive downloads to the local machine (`dc3ce6e`).
- **Desktop — live download telemetry**: per-file speed and an aggregate total in the Downloading
  section (`3e94b37`).
- **Desktop — Drive change detection**: files whose content changed (same `fileId`, new md5) are
  detected as stale and re-fetched, which re-extracts and re-publishes their metadata. Adds
  `cache_entries.source_md5` — **SQLite schema v7**, with a backfill so existing downloads get a
  baseline (`e8c0ef4`).
- **Desktop — cover art for cloud-only tracks**: art extracted at download time is recorded in a new
  `drive_artwork` table — **SQLite schema v8** — plus a startup backfill for files downloaded
  earlier. Art deliberately outlives both a Drive re-index and cache eviction (`e3b5237`).
- **UI — collapsible sidebar sections** and an account menu in the top bar (`8ff276c`).
- **Web — favicon**: the desktop app icon now serves as the web favicon (`cfe0b6b`).

### Changed
- **UI — account control** folded into each view's header; a 25-file refactor across desktop and
  web (`d441968`).
- **Desktop — download concurrency**: Drive files now download with **bounded concurrency** rather
  than unbounded parallelism (`b3b9c50`).

### Fixed
- **Queue clearing** — one bug, three commits, three clients: clearing the queue now also clears the
  saved resume point on desktop (`5423e5b`) and web (`f381eb5`), and a cleared queue propagates to
  other devices (`a1247c0`). Regression-tested by "an empty queue.set clears the handoff row and
  reaches the other device" ([syncEngine.test.ts:404](../packages/core/tests/syncEngine.test.ts)).
- **Desktop — startup crash**: jump-list initialization caused a black screen and auto-close on
  startup; a Phase 8c regression (`62a4e1b`).
- **Web — track language**: the folder-derived language is now preserved on synced cloud tracks
  (`3435a8d`).

### Documentation
- Android Drive setup gained the **Enable Custom URI Scheme** step, without which Google returns
  `Error 400: invalid_request` (`73c0e9e`).

---

## [1.0.0] — 2026-07-17

The complete ten-phase build ([PLAN.md](../PLAN.md) Phases 0–9). Full derivation:
[PHASE_PROGRESS.md](PHASE_PROGRESS.md).

### Phase 9 — Hardening & release · 2026-07-16 → 07-17

#### Added
- **Tests**: Rust cache-LRU suite (5 invariant tests) and Playwright web e2e — smoke always, signed-in
  flows behind `E2E_EMAIL`/`E2E_PASSWORD` (`c889289`).
- **Diagnostics**: sync-engine breadcrumbs on every client (`cycle.start`, `flush.coalesced`,
  `flush.conflictLost`, `pull.applied`, `enqueue.dropped`, …) plus an error/logging audit
  (`e2ea257`).
- **CI/CD**: GitHub Actions running every suite per push/PR, plus NSIS installer and APK builds on
  `v*` tags or manual dispatch (`8d811d5`).
- **Docs**: consolidated setup guide, public `/help` user docs on the web app, sync-protocol
  diagnostics section, README wrap-up (`36e11d8`).

#### Performance
- Virtualized track lists (50k-ready) via `useVirtualRows`, a 256px artwork thumbnail tier with
  startup backfill, lazy-loaded heavy web views, and startup profiling (`72363ae`).

### Phase 8 — Desktop polish & power features · 2026-07-16

#### Added
- **AMOLED theme**, custom accent color picker, follow-system-theme (`5cbe27f`).
- **Mini player**: an always-on-top frameless second webview with multiwindow support; the main
  window hides but keeps running as the "brain" (`a8404f0`).
- **System tray** with transport controls and **Windows jump lists** — both reuse the `smtc://control`
  channel so media keys, tray and taskbar share one dispatch path (`aac1468`).
- **ReplayGain playback stage** (track/album) in the Rust engine, applied per-stream so it stays
  correct across gapless splices; **APE and WavPack decoders** — the latter via vendored libwavpack
  C sources compiled by `build.rs`, needing no CMake or bindgen (`f8460da`).
- **Live folder watching** (`notify`, debounced) with roots persisted in a new `watched_folders`
  table — **SQLite schema v6** — and a content-hash **Duplicates view** (`a399c79`).

### Phase 7 — Statistics 2.0 · 2026-07-16

#### Added
- **Core stats engine**: play-event aggregation with golden fixtures (`9b6e498`).
- **Local play-event logs** on all three clients — desktop SQLite (**schema v5**), web IndexedDB
  (`mv-stats`), Android Room (**Room v6**) — each deliberately surviving sign-out, and each syncing
  as an append-only `playEvent.add` stream deduped by shared event id
  (`cc6d8ee`, `bcf3d48`, `4a66c95`).
- **Charts, calendar heatmap, streaks, listening clock, top lists** on all clients; a Wrapped-style
  **yearly recap** on desktop and web.

> ⚠️ Android's recap engine was ported but no screen was built for it — see
> [FEATURE_PARITY.md](FEATURE_PARITY.md).

### Phase 6 — Android cloud parity · 2026-07-15 → 07-16

#### Added
- **Kotlin sync-engine port**: fractional index, op envelope, LWW flush/pull, full test suite
  (`8c0ddd9`), wired into the app (`b74c358`). **Room v3** adds `sync_outbox`/`sync_cursors`/`sync_shadow`.
- **Google Drive on Android**: OAuth (AppAuth + custom scheme), scanner, library merge with cloud
  badge (`d1f6e58`). **Room v4** adds the Drive index.
- **Two-tier cache** (Media3 `SimpleCache` + a `downloads` table — **Room v5**), WorkManager
  downloads, hybrid play-through-cache (`f2455ee`).
- **Smart-rule builder UI** (`9cf0c0d`).
- **Material You dynamic color** + AMOLED theme (`d459f1e`).

### Phase 5 — Web app · 2026-07-15

#### Added
- **Next.js 16 rewrite**: App Router, Supabase SSR auth, the sync engine over IndexedDB, Drive
  downloads through an OPFS two-tier cache, Web Audio playback (`5d27bfb`).
- Web setup docs: env, Google Web OAuth client, Vercel deploy (`7e0788c`).

### Phase 4 — Sync engine · 2026-07-15

#### Added
- **The sync engine**: persisted outbox (survives crashes), LWW merge, fractional indexes, Supabase
  Realtime, cross-device queue handoff; spec in [docs/sync-protocol.md](../docs/sync-protocol.md)
  (`5ae7b45`). **SQLite v4**; **Supabase migration 0003**.

#### Changed
- **Deletions became soft state**: un-favoriting sets `favorite = false`; playlists and items gained
  `deleted_at` — because deletions are invisible to `updated_at` cursors.
- **Ratings widened from 1–5 to 0–5**, where 0 means "cleared".
- **`playlist_tracks` lost its FK to `tracks(id)`** on desktop, so synced playlists can reference
  cloud-only tracks that have no local row yet.
- Added `edited_at` (client LWW clock) alongside `updated_at` (server cursor clock), and
  `play_events.created_at` for server receive time.

### Phase 3 — Google Drive on desktop · 2026-07-14

#### Added
- **OAuth**: PKCE loopback flow with the refresh token in Windows Credential Manager (`b99db37`).
- **Scanner + library merge**: cloud tracks appear with a badge (`edae1ac`). **SQLite v3** adds
  `drive_files`, `drive_folders`, `cache_entries`.
- **Two-tier cache, hybrid playback, downloads UI, metadata push** to Supabase (`8ac57aa`).

#### Changed
- **Supabase migration 0002**: `tracks` unique indexes converted from partial to full, because
  PostgREST cannot infer partial unique indexes for upsert.

### Phase 2 — Metadata & track identity · 2026-07-14

#### Added
- Extended tags (album artist, track/disc number, composer, BPM, ReplayGain), **ratings**,
  **BLAKE3 content hashing**, and the shared **smart-rule engine** (TypeScript + Kotlin, pinned by
  golden fixtures) (`2fceaa8`). **SQLite v2**; **Room `MIGRATION_1_2`**.

### Phase 1 — Supabase foundation · 2026-07-14

#### Added
- **Migration 0001**: the full schema — 9 tables, RLS on every one, `set_updated_at()` and
  `handle_new_user()` triggers. `play_events` is append-only by construction (select + insert
  policies, no update/delete).
- Core Supabase module; sign-in/sign-up and device registration on desktop and Android (`6ca4171`).

### Phase 0 — Monorepo bootstrap · 2026-07-14

#### Added
- npm-workspaces monorepo; desktop and Android apps imported; shared `@musicvault/core` extracted
  and consumed by desktop; builds verified (`80edb55`).

---

## Schema version history

Useful when diagnosing an old install. Details in [DATABASE.md](DATABASE.md).

| Release | Desktop SQLite | Android Room | Supabase |
|---|---|---|---|
| Phase 0 | v1 | v1 | — |
| Phase 1 | v1 | v1 | 0001 |
| Phase 2 | v2 | v2 | 0001 |
| Phase 3 | v3 | v2 | 0002 |
| Phase 4 | v4 | v2 | 0003 |
| Phase 5 | v4 | v2 | 0003 |
| Phase 6 | v4 | v3 → v5 | 0003 |
| Phase 7 | v5 | v6 | 0003 |
| Phase 8 | v6 | v6 | 0003 |
| Phase 9 | v6 | v6 | 0003 |
| Post-1.0 | v8 | v6 | 0003 |
| Vault migration | **v9** (fresh start) | **v7** (fresh start) | **0005** |

---

## Notes on this changelog

- **No tags exist**, so the 1.0.0 boundary is drawn at `36e11d8` — the last commit that names a
  phase and the one that marks the README complete. `release.yml` triggers on `v*` tags, so a
  `v1.0.0` tag would produce the installer and APK.
- Phase commits carry their own summaries; this changelog compresses 32 phase commits into ten
  sections and lists the 13 post-1.0 commits by theme.
- Version numbers are inconsistent across manifests: `1.0.0` in the JS/Rust manifests vs `"1.0"` /
  `versionCode 1` on Android. Worth aligning before a real release.
