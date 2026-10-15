# Repository Structure

> Audit date: 2026-07-17 · branch `main` @ `e3b5237` · 450 tracked files. Folder tables for the
> three apps updated 2026-10-15.
> Derived from `git ls-files`, so build outputs (`target/`, `.gradle/`, `.next/`,
> `node_modules/`) are excluded — they are ignored by [.gitignore](../.gitignore).

## Top level

```
music-vault/
├── apps/
│   ├── desktop/        Tauri 2 + React 19 + Rust — Windows player
│   ├── android/        Kotlin + Compose + Media3 + Room
│   └── web/            Next.js 16 App Router
├── packages/
│   └── core/           @musicvault/core — shared TypeScript engine
├── supabase/
│   ├── migrations/     SQL schema + RLS (5 migrations)
│   ├── functions/      the `vault` Edge Function (pre-signed R2 URLs)
│   └── tests/          RLS + vault smoke tests, track-edit golden runner
├── docs/               Architecture, protocol, setup guides, golden fixtures
├── reports/            ← this audit
├── .github/workflows/  CI + release pipelines
├── .claude/launch.json Dev-server definitions for the Claude Code browser pane
├── PLAN.md             The original phase-by-phase build plan (phases 0–9)
├── README.md           Entry point + phase status checklist
└── package.json        npm workspaces root + task aliases
```

**Notes on folders the reader might expect but that do not exist:** there is no `scripts/`
directory (all task entry points are npm scripts in the root [package.json](../package.json) or
Gradle tasks), no `shared/` directory (shared code lives in `packages/core`), and no
`packages/*` beyond `core`.

## Root manifest — [package.json](../package.json)

An npm **workspaces** root (`workspaces: ["packages/core", "apps/desktop", "apps/web"]`).
Android is deliberately outside the JS workspace graph — it is a Gradle build. The root defines
only aliases that delegate into workspaces; there is no root build step:

| Script | Delegates to |
|---|---|
| `core:test`, `core:typecheck` | `@musicvault/core` (vitest, tsc) |
| `desktop:dev`, `desktop:build`, `desktop:lint`, `desktop:typecheck` | `music-vault-desktop` |
| `web:dev`, `web:build`, `web:lint`, `web:typecheck`, `web:e2e` | `music-vault-web` |

## `packages/core` — the shared engine

`@musicvault/core` ([package.json](../packages/core/package.json)) is **private, unbuilt, and
source-only**: `main` and `types` both point at `./src/index.ts`. Consumers compile it
themselves — which is why [apps/web/next.config.ts](../apps/web/next.config.ts) sets
`transpilePackages: ["@musicvault/core"]`. Its only runtime dependency is `@supabase/supabase-js`.

Everything is re-exported through [src/index.ts](../packages/core/src/index.ts):

| File | Lines | Responsibility |
|---|---:|---|
| [types.ts](../packages/core/src/types.ts) | 111 | `Track`, `Playlist`, `Settings`, `RepeatMode`, `ReplayGainMode`, `AccentColor`, EQ presets/frequencies |
| [smartRules.ts](../packages/core/src/smartRules.ts) | 374 | Smart-playlist rule AST + evaluator (the shared rule engine) |
| [smartPlaylists.ts](../packages/core/src/smartPlaylists.ts) | 104 | Built-in smart playlists (non-rule-based) |
| [stats.ts](../packages/core/src/stats.ts) | 474 | Play-event aggregation engine (Statistics 2.0) |
| [albums.ts](../packages/core/src/albums.ts) | 24 | Album grouping |
| [lrc.ts](../packages/core/src/lrc.ts) | 29 | LRC synced-lyrics parser |
| [format.ts](../packages/core/src/format.ts) | 17 | Duration/size formatting |
| [playlists.ts](../packages/core/src/playlists.ts) | 9 | Playlist helpers |
| [trackFields.ts](../packages/core/src/trackFields.ts) | — | Editable vs read-only track fields, patch normalization, `applyTrackEdit` (field-level LWW) |
| [vault.ts](../packages/core/src/vault.ts) | — | Client for the `vault` Edge Function, `SignedUrlCache`, `deletedVaultHashes` |
| [upload.ts](../packages/core/src/upload.ts) | — | Upload draft model, batch fields, cover rules, `uploadTrack` orchestration |
| [supabase/](../packages/core/src/supabase) | — | `client.ts`, `auth.ts`, `devices.ts`, hand-maintained `database.types.ts` |
| [sync/](../packages/core/src/sync) | 1 713 | The sync engine — see below |

`packages/core/src/sync/` is the largest subsystem in the package:
[engine.ts](../packages/core/src/sync/engine.ts) (872 lines — the cycle: enqueue → coalesce →
flush → pull → project), [transport.ts](../packages/core/src/sync/transport.ts) (337, the
Supabase wire layer), [types.ts](../packages/core/src/sync/types.ts) (230, op envelope + payload
union + key functions), [fractional.ts](../packages/core/src/sync/fractional.ts) (170, fractional
index keys for mergeable reordering), [storage.ts](../packages/core/src/sync/storage.ts) (99, the
`SyncStorage` port each client implements).

Tests live in [packages/core/tests/](../packages/core/tests) — seven vitest suites; see
[TESTING.md](TESTING.md).

## `apps/desktop` — Tauri 2

Two halves that talk over Tauri IPC. Frontend config: [vite.config.ts](../apps/desktop/vite.config.ts)
pins port **1420** (`strictPort`), ignores `src-tauri/**` in the watcher (cargo holds file locks),
and targets `chrome120`. App config: [tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json)
— NSIS bundle, `main` window 1200×800 (min 900×600), asset protocol scoped to `$APPDATA/artwork/**`.

### Frontend — `apps/desktop/src/`

| Folder | Contents |
|---|---|
| `components/` | 47 React components (2026-10-15) — views (`LibraryView`, `AlbumPage`, `ArtistPage`, `PlaylistView`, `SmartPlaylistView`, `StatsView`, `Heatmap` (6-month card + Listening History), `RecapView`, `DownloadsView`), vault (`UploadDialog`, `TrackEditor`, `TrackFields`), chrome (`TopBar`, `Sidebar`, `ViewHeader`, `AccountMenu`, `NowPlayingBar`, `NowPlayingScreen`, `MiniPlayer`, `QueuePanel`), controls (`EqualizerPanel`, `Visualizer`, `LyricsPanel`, `SleepTimer`, `ThemeSwitcher`, `SmartRulesEditor`, `SmartPlaylistDialog`, `DownloadAllButton`, `ChartTooltip`, `Mosaic`) |
| `store/` | 11 Zustand stores: `library`, `player`, `download`, `upload`, `sync`, `stats`, `history`, `auth`, `settings`, `sleep`, `ui` |
| `lib/` | `ipc.ts` (the typed `invoke` wrapper), `db.ts`, `player.ts`, `vault.ts` (vault client + play resolver), `vaultMerge.ts` (library projection), `vaultActions.ts`, `vaultCleanup.ts`, `trackForm.ts`, `covers.ts`, `freshStart.ts`, `smartEval.ts`, `syncBus.ts`, `syncStorage.ts`, `miniBridge.ts`, `lastPlayback.ts`, `paths.ts`, `supabase.ts` |
| `hooks/` | `useAudioEngine`, `useKeyboardShortcuts`, `useSmtc`, `useTheme`, `useVirtualRows`, `useNotifications`, `useFileDrop`, `useMiniBridge` |
| `types/` | Desktop-specific extensions of the core types |

### Backend — `apps/desktop/src-tauri/src/` (6 340 lines of Rust)

| Module | Lines | Responsibility |
|---|---:|---|
| [lib.rs](../apps/desktop/src-tauri/src/lib.rs) | 212 | Builder, plugin/state setup, the 48-command `invoke_handler`, startup profiling, exit handling |
| [main.rs](../apps/desktop/src-tauri/src/main.rs) | — | Thin binary entry — calls `music_vault_lib::run()` |
| `audio/` | 1 811 | `decoder.rs` (615), `engine.rs` (526), `output.rs` (cpal), `eq.rs` (10-band biquad), `resampler.rs`, `analyzer.rs` (FFT), `events.rs`, `wv.rs` (WavPack FFI) |
| `db/` | 1 215 | `mod.rs` (open/migrate, schema v8), `queries.rs` (690), `models.rs` |
| `vault/` | 806 | `prepare.rs` (hash, tags, cover JPEG + thumb for uploads), `transfer.rs` (streamed PUT, BLAKE3-verified download), `cache.rs` (two-tier LRU) |
| `scan/` | 140 | `tags.rs` (lofty), `hash.rs` (BLAKE3) — file reading for uploads |
| `commands/` | ~520 | IPC surface split by domain: `player`, `playlists`, `settings`, `sync`, `history`, `vault`, `window` |
| [smtc.rs](../apps/desktop/src-tauri/src/smtc.rs) / [tray.rs](../apps/desktop/src-tauri/src/tray.rs) / [jumplist.rs](../apps/desktop/src-tauri/src/jumplist.rs) | 311 | Windows shell integration (media keys, tray, taskbar tasks) |
| [error.rs](../apps/desktop/src-tauri/src/error.rs) | — | `AppError` / `AppResult` |

`src-tauri/vendor/wavpack/` holds **vendored libwavpack C sources** (BSD-3, `COPYING` included),
compiled by [build.rs](../apps/desktop/src-tauri/build.rs) via the `cc` crate so `.wv` playback
needs no CMake or bindgen. `capabilities/default.json` grants `core:default`, `dialog:default`
and `notification:default` to the `main` and `mini` windows.

## `apps/android` — Gradle

Standard single-module Gradle build: [settings.gradle.kts](../apps/android/settings.gradle.kts)
includes only `:app`. Versions are centralized in the version catalog
[gradle/libs.versions.toml](../apps/android/gradle/libs.versions.toml). Secrets come from an
uncommitted `local.properties` or environment variables
([app/build.gradle.kts](../apps/android/app/build.gradle.kts)) — see
[ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).

Package layout under `app/src/main/java/com/musicvault/` (14 903 lines of Kotlin):

| Package | Responsibility |
|---|---|
| `data/db/` | Room: `Entities.kt`, `Daos.kt`, `MusicVaultDatabase.kt` (v7 + 6 migrations) |
| `data/sync/` | Kotlin sync-engine port: `SyncEngine.kt` (785), `SupabaseSyncTransport.kt` (364), `RoomSyncStorage.kt`, `Fractional.kt`, `SyncTypes.kt`, `SyncManager.kt`, `SyncBus.kt`, `RemoteTrackIndex.kt` |
| `data/vault/` | `VaultApi.kt` (function client over OkHttp), `UploadManager.kt`, `TrackForm.kt`, `VaultMerge.kt` (library projection), `VaultArtwork.kt`, `AudioCache.kt` (auto-cache cap, clear, auto-download switch), `DownloadRepository.kt`, `DownloadWorker.kt`, `AutoDownloader.kt` |
| `data/repo/` | `LibraryRepository.kt`, `HistoryRepository.kt`, `StatsRepository.kt` |
| `data/scanner/` | `TagParser.kt` (JAudioTagger) — tag reading for uploads |
| `data/FreshStart.kt` | One-time cleanup of the pre-vault library's files |
| `data/cloud/` | `AuthRepository.kt`, `CloudClient.kt` (supabase-kt) |
| `data/prefs/` | `SettingsRepository.kt` (DataStore) |
| `domain/` | The **Kotlin ports** of the shared engine: `SmartRules.kt`, `SmartRulesMeta.kt`, `SmartPlaylists.kt`, `Stats.kt` (460), `Albums.kt`, `Lrc.kt`, `Format.kt`, `model/Models.kt` |
| `playback/` | `VaultPlayer.kt` (653 — dual-ExoPlayer gapless/crossfade), `PlaybackService.kt`, `PlaybackController.kt`, `QueueState.kt`, `EqController.kt`, `VaultDataSource.kt` |
| `ui/` | Compose: `AppRoot.kt` (top bar, bottom tabs, routes), `AccountMenu.kt` + `AccountSection.kt` (the avatar's dropdown), ViewModels, `screens/` (11, including `HeatmapScreen.kt`), `player/` (8), `components/` (9, including `Mosaic.kt`), `vault/` (upload screen, track editor, share intake), `theme/Theme.kt` |
| `di/` | Hilt modules: `AppModule.kt`, `CoroutinesModule.kt` |
| `demo/` | `DemoLibrary.kt` (the invented library for README screenshots, ported from the web's `demo.ts`) and `DemoShots.kt` (which screen to show); both act only in the `demo` build type |

Entry points: [MainActivity.kt](../apps/android/app/src/main/java/com/musicvault/MainActivity.kt) and
the `@HiltAndroidApp` [MusicVaultApp.kt](../apps/android/app/src/main/java/com/musicvault/MusicVaultApp.kt).
JVM unit tests sit in `app/src/test/java/com/musicvault/` (7 suites).
`scripts/demo-shots.mjs` builds the `demo` build type, captures it on an emulator and writes
`docs/screenshots/android-*.webp` (`npm run android:demo-shots`).

## `apps/web` — Next.js 16

App Router. [next.config.ts](../apps/web/next.config.ts) transpiles `@musicvault/core`;
[src/proxy.ts](../apps/web/src/proxy.ts) refreshes Supabase auth cookies on every matched
request and bounces signed-out visitors to `/login` (public paths: `/login`, `/auth`, `/help`).

| Path | Contents |
|---|---|
| `src/app/` | Routes: `[[...view]]/page.tsx` (the app, at every in-app address), `manifest.ts` (the PWA manifest), `login/`, `account/` (no longer linked from the menu), `help/` (public user docs), `layout.tsx`, `globals.css`, favicon/icon assets |
| `src/components/` | 47 components (2026-10-15) — largely 1:1 counterparts of the desktop set, plus `MusicVaultApp.tsx` |
| `src/lib/` | `audioEngine.ts`, `audioCache.ts` (OPFS, BLAKE3-verified), `db.ts` (IndexedDB), `syncStorage.ts`, `playEventLog.ts`, `vault.ts`, `uploadPrepare.ts`, `vaultActions.ts`, `trackForm.ts`, `artwork.ts`, `trackMap.ts` (library projection), `urlSync.ts` (address bar ↔ view), `pwa.ts` (service worker + install offer), `demo.ts` (the invented library for README screenshots; dead code outside demo builds), `freshStart.ts`, `smartEval.ts`, `errorBus.ts`, `lastPlayback.ts`, `supabase/{browser,server}.ts` |
| `src/store/` | The same 11 Zustand stores as desktop |
| `public/` | `sw.js` (the service worker), `icons/` (PWA icons, including a maskable one) |
| `scripts/` | `demo-shots.mjs`: builds a demo into `.next-demo/` and captures the README screenshots into `docs/screenshots/` |
| `src/hooks/` | `useAudioEngine`, `useMediaSession`, `useKeyboardShortcuts`, `useNotifications`, `useVirtualRows` |
| `e2e/` | Playwright specs: `unauthenticated.spec.ts`, `authenticated.spec.ts` |

The web app has no API routes of its own: audio and covers go straight between the browser and
R2 through signed URLs from the `vault` Edge Function. See [VAULT.md](VAULT.md).

## `supabase/`

- [migrations/0001_init.sql](../supabase/migrations/0001_init.sql) (277 lines) — full schema + RLS
- [migrations/0002_track_identity_upsert.sql](../supabase/migrations/0002_track_identity_upsert.sql) (11) — upsert-compatible unique indexes
- [migrations/0003_sync.sql](../supabase/migrations/0003_sync.sql) (89) — Phase 4 sync columns, soft deletes, Realtime publication
- [migrations/0004_vault.sql](../supabase/migrations/0004_vault.sql) (354) — vault columns, protected-column trigger, `apply_track_edit`, `resolve_upload_target`, `merge_tracks`, `delete_track`
- [migrations/0005_drop_drive.sql](../supabase/migrations/0005_drop_drive.sql) (131) — Drive columns dropped; identity = content hash
- [functions/vault/](../supabase/functions/vault) — the `vault` Edge Function (`index.ts`, `handler.ts`, `keys.ts`), its vitest suite and the live `smoke.mjs`
- [tests/rls_smoke.sql](../supabase/tests/rls_smoke.sql) (53) — RLS smoke test
- [tests/vault_smoke.sql](../supabase/tests/vault_smoke.sql) (206) — vault schema smoke test
- [tests/track_edit_golden.mjs](../supabase/tests/track_edit_golden.mjs) (98) — runs the track-edit golden fixture against `apply_track_edit`

Schema detail: [DATABASE.md](DATABASE.md).

## `docs/`

Pre-existing project documentation (this audit's output is in `reports/`):

| File | What |
|---|---|
| [architecture.md](../docs/architecture.md) | Architecture + principles + per-phase design notes |
| [sync-protocol.md](../docs/sync-protocol.md) | The sync wire protocol and diagnostics |
| [setup.md](../docs/setup.md) | Zero-to-running walkthrough |
| [setup-supabase.md](../docs/setup-supabase.md) | Supabase project setup |
| [web-setup.md](../docs/web-setup.md) | Web env, local dev, Vercel |
| [vault-setup.md](../docs/vault-setup.md) | R2 bucket, token, CORS, secrets, deploying the `vault` function |
| [drive-to-r2-migration.md](../docs/drive-to-r2-migration.md) | The record of the move from Google Drive to the vault |
| [fixtures/smart-rules.golden.json](../docs/fixtures/smart-rules.golden.json) | Golden fixture pinning the TS and Kotlin rule engines |
| [fixtures/stats.golden.json](../docs/fixtures/stats.golden.json) | Golden fixture pinning both stats engines |
| [fixtures/track-edit.golden.json](../docs/fixtures/track-edit.golden.json) | Golden fixture pinning track edits in SQL, TypeScript and Kotlin |

The fixtures are **not documentation** — they are test inputs loaded by both
`packages/core/tests/` and the Android JVM tests. See [TESTING.md](TESTING.md).

## `.github/workflows/`

- [ci.yml](../.github/workflows/ci.yml) — runs every suite per push/PR
- [release.yml](../.github/workflows/release.yml) — NSIS installer + debug APK on manual dispatch

Details in [BUILD_AND_RUN.md](BUILD_AND_RUN.md#cicd).

## Ignored / generated paths

[.gitignore](../.gitignore) excludes `node_modules/`, `dist/`, `apps/desktop/src-tauri/target/`,
`apps/android/{.gradle,build,app/build,.kotlin}/`, `apps/android/local.properties`, `*.apk`,
`*.aab`, `apps/web/{.next,out}/`, Playwright reports, `.env*` (except `.env.example`),
`supabase/.temp/`, IDE/OS files and logs. Note `apps/desktop/.gitignore` also ignores `.claude/`
locally.
