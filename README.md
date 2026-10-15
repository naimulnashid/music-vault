# MusicVault — Cross-Platform Personal Music Library & Player

[![CI](https://github.com/naimulnashid/music-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/naimulnashid/music-vault/actions/workflows/ci.yml)

Personal music ecosystem for people who own their music: a Windows desktop
player (Tauri 2 + React + Rust), a native Android app (Kotlin + Compose +
Media3), and a web app (Next.js 16) sharing one account, one library, and one
set of playlists/favorites/history. The audio lives in a private
Cloudflare R2 bucket (the **vault**); Supabase holds the account, every
track's details (edited online from any app) and the sync state. Songs are
uploaded by hand from any of the three apps.

## Run your own

Music Vault has no shared server: each install runs on its owner's own free
Supabase project and Cloudflare R2 bucket. Setting one up takes these steps,
each with its own guide:

1. A Supabase project with the migrations
   ([docs/setup-supabase.md](docs/setup-supabase.md)).
2. An R2 bucket, its CORS rules and API token, and the `vault` Edge Function
   that signs its URLs ([docs/vault-setup.md](docs/vault-setup.md)).
3. The web app on Vercel ([docs/web-setup.md](docs/web-setup.md)).
4. The Windows and Android apps, built with your project's URL and anon key
   ([docs/setup.md](docs/setup.md)).

There are no prebuilt installers: a build carries the Supabase project it was
made for, so you build your own.

## Layout

```
apps/desktop     Windows app — Tauri 2, React 19, TS, Tailwind, Rust audio engine
apps/android     Android app — Kotlin, Jetpack Compose, Media3, Room
apps/web         Web app — Next.js 16 on Vercel (Phase 5)
packages/core    Shared TypeScript (sync engine, vault client, upload model, smart playlists)
supabase/        SQL migrations + RLS, the `vault` Edge Function (pre-signed R2 URLs)
docs/            Architecture & protocol docs
PLAN.md          Full build plan (phases 0–9)
```

## Development

Prerequisites: Node 20+, Rust (stable, MSVC) + WebView2 for desktop,
JDK 17 + Android SDK for Android.

```sh
npm install               # installs all JS workspaces

# shared core
npm run core:test         # vitest
npm run core:typecheck

# desktop
npm run desktop:dev       # tauri dev (hot reload)
npm run desktop:build     # frontend typecheck + bundle
npm run desktop:lint

# android
cd apps/android
./gradlew.bat :app:assembleDebug
./gradlew.bat testDebugUnitTest

# web
npm run web:dev           # next dev on http://localhost:3000
npm run web:build
npm run web:typecheck
npm run web:lint
```

Web env setup: copy `apps/web/.env.example` to `apps/web/.env.local` and fill
in — see [docs/web-setup.md](docs/web-setup.md). The full zero-to-running
walkthrough (Supabase, the R2 vault, Vercel, CI secrets) is
[docs/setup.md](docs/setup.md).

## Testing & CI

```sh
npm run core:test         # shared engine suites (sync conflicts, smart rules, stats, LRC)
npm run web:e2e           # Playwright (set E2E_EMAIL/E2E_PASSWORD for signed-in flows)
cd apps/desktop/src-tauri && cargo test   # Rust engine/cache/DB tests
cd apps/android && ./gradlew.bat testDebugUnitTest
```

GitHub Actions run all of the above on every push/PR
([ci.yml](.github/workflows/ci.yml)). In a fork with your own Supabase secrets,
tagging `v*` (or manual dispatch) builds the Windows NSIS installer and Android
APK ([release.yml](.github/workflows/release.yml)); it skips itself in the
public `naimulnashid/music-vault` repository. Vercel builds web previews per
push once the repo is linked. User docs ship with the web app at `/help`.

## Status

- [x] **Phase 0** — monorepo bootstrap: desktop + android imported, shared
      `@musicvault/core` extracted and consumed by desktop, builds verified
- [x] **Phase 1** — Supabase foundation: schema + RLS migration, core supabase
      module, sign-in/up + device registration on desktop and Android
      (needs a Supabase project — see [docs/setup-supabase.md](docs/setup-supabase.md))
- [x] **Phase 2** — metadata & track-identity upgrade: extended tags, ratings,
      BLAKE3 hashing, shared smart-rule engine (TS + Kotlin, golden fixtures)
- [x] **Phase 3** — Google Drive on desktop: PKCE OAuth, scanner + library
      merge, two-tier cache, hybrid playback, downloads UI, metadata push
- [x] **Phase 4** — sync engine: persisted outbox, LWW merge, fractional
      indexes, Realtime, queue handoff (spec in [docs/sync-protocol.md](docs/sync-protocol.md))
- [x] **Phase 5** — web app: Next.js 16 App Router + Supabase SSR auth, sync
      engine over IndexedDB, Drive downloads through OPFS two-tier cache,
      Web Audio playback (see [docs/web-setup.md](docs/web-setup.md))
- [x] **Phase 6** — Android cloud parity: Kotlin sync engine port (full
      conflict-test suite), Google Drive OAuth + scanner + library merge,
      two-tier cache with WorkManager downloads and hybrid play-through-cache,
      smart-rule builder, Material You + AMOLED themes
- [x] **Phase 7** — Statistics 2.0: full play events recorded locally on every
      client (SQLite / IndexedDB / Room, surviving sign-out) and synced as an
      append-only stream; shared aggregation engine (TS + Kotlin, golden-fixture
      locked) powering range charts, calendar heatmap, streaks, listening clock
      and top lists on all clients, plus a Wrapped-style yearly recap on
      desktop and web
- [x] **Phase 8** — desktop polish & power features: always-on-top mini player
      window (event bridge to the hidden main window), system tray with
      transport controls + Windows jump-list tasks, AMOLED theme + custom
      accent color picker + follow-system theme, ReplayGain playback stage
      (track/album) in the Rust engine, APE + WavPack decoders (vendored
      libwavpack, no extra toolchain), live folder watching (notify) and a
      content-hash Duplicates view. Later removed: folder watching and
      Duplicates with the vault migration, the accent picker in the
      2026-10-13 redesign (one violet accent everywhere)
- [x] **Phase 9** — hardening & release: Rust cache-LRU tests + Playwright web
      e2e on top of the existing suites, sync-engine breadcrumb diagnostics on
      every client, virtualized track lists (50k-ready) + artwork thumbnail
      pipeline + lazy-loaded web views + startup profiling, GitHub Actions CI
      (tests per app) with NSIS installer / APK release builds, consolidated
      setup guide and public `/help` user docs on the web app

- [x] **Vault migration (M0–M8)** — Google Drive replaced by a private R2
      bucket behind a Supabase Edge Function: manual upload from all three
      apps (tags only pre-fill the form), every detail and cover edited online
      with field-level last-writer-wins, delete from vault anywhere, verified
      (BLAKE3) downloads and offline pins. Drive, local-folder libraries and
      local mode are gone; the library was rebuilt from scratch
      ([docs/drive-to-r2-migration.md](docs/drive-to-r2-migration.md))

Phases 3, 5, 6 and 8 originally built Google Drive streaming and local-folder
libraries; the vault migration replaced both. See [PLAN.md](PLAN.md) and
[docs/architecture.md](docs/architecture.md).
