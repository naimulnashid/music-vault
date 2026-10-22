# Build & Run Guide

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; updated 2026-10-13 for the vault.
> Complete setup for all three clients. Variable reference: [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).
> The repo also ships its own guides — [docs/setup.md](../docs/setup.md) (zero-to-running),
> [docs/setup-supabase.md](../docs/setup-supabase.md), [docs/vault-setup.md](../docs/vault-setup.md),
> [docs/web-setup.md](../docs/web-setup.md).

## The one thing to know first

**Every client needs the Supabase project, and the project needs the vault.** The library lives
in the account: tracks are rows in Supabase and their audio is in a private Cloudflare R2 bucket
reached through the `vault` Edge Function ([VAULT.md](VAULT.md)). A client built without its
Supabase URL + anon key starts, but only to say that no account is configured — there is no local
mode. So the order is: Supabase (§6) → the vault (§7) → the clients.

---

## 1. Prerequisites

| Tool | Version | Needed for | Evidence |
|---|---|---|---|
| **Node.js** | **22** (CI); README says 20.19+ or 22.12+ | everything JS | [ci.yml](../.github/workflows/ci.yml) uses `node-version: 22`; [README.md](../README.md) says "Node 20.19+ or 22.12+", the floor Vite 8 and Next 16 set |
| **npm** | ships with Node | workspaces | root [package.json](../package.json) |
| **Rust** | stable, **MSVC** toolchain | desktop | [README.md:25](../README.md); CI uses `dtolnay/rust-toolchain@stable` on `windows-latest` |
| **WebView2** | current | desktop runtime | [README.md:25-26](../README.md) |
| **JDK** | **17** (temurin) | Android | [build.gradle.kts:53-58](../apps/android/app/build.gradle.kts) (`VERSION_17`, `jvmTarget = "17"`); CI `java-version: 17` |
| **Android SDK** | compileSdk/targetSdk **35**, minSdk **28** | Android | [build.gradle.kts:24-31](../apps/android/app/build.gradle.kts) |
| **Gradle** | wrapper (8.10.2) | Android | [gradle/wrapper/gradle-wrapper.properties](../apps/android/gradle/wrapper/gradle-wrapper.properties) — use `./gradlew`, don't install Gradle |
| **Android Studio** | optional | emulator/IDE | not required by any script |

No CMake, bindgen or C toolchain beyond MSVC is needed: libwavpack is vendored and compiled by the
`cc` crate in [build.rs](../apps/desktop/src-tauri/build.rs)
([docs/architecture.md:125-127](../docs/architecture.md)).

## 2. First-time install

```sh
git clone <repo> && cd "Music Vault - Cross Platform"
npm install          # installs ALL JS workspaces (core + desktop + web)
```

Android is **not** part of the npm workspace graph — it builds only through Gradle.

---

## 3. Desktop (Windows)

### Run in development
```sh
npm run desktop:dev          # = npm run tauri dev -w music-vault-desktop
```
Tauri starts Vite on **port 1420** (`strictPort: true` —
[vite.config.ts](../apps/desktop/vite.config.ts)) and opens the native window with hot reload.
`beforeDevCommand: "npm run dev"`, `devUrl: http://localhost:1420`
([tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json)).

### Frontend-only checks
```sh
npm run desktop:build        # tsc -b && vite build  → apps/desktop/dist
npm run desktop:typecheck    # tsc -b
npm run desktop:lint         # oxlint
```
Note `desktop:build` builds **only the frontend bundle**, not the app.

### Build the installer
```sh
npm run tauri build -w music-vault-desktop
# → apps/desktop/src-tauri/target/release/bundle/nsis/*.exe
```
`beforeBuildCommand: "npm run build"` runs the frontend build first; `frontendDist: "../dist"`.
The only bundle target is **NSIS** (`"targets": ["nsis"]`) — no MSI, macOS or Linux target is
configured. [windows/hooks.nsh](../apps/desktop/src-tauri/windows/hooks.nsh) leaves the finish
page's "Create desktop shortcut" box unticked and removes the shortcut silent installs make.

### Debug vs release
- `tauri dev` → debug Rust, dev server frontend, devtools available.
- `tauri build` → release profile with `lto = true`, `codegen-units = 1`, `strip = true`
  ([Cargo.toml](../apps/desktop/src-tauri/Cargo.toml)). Slow to compile, small and fast to run.

### Environment
Copy [apps/desktop/.env.example](../apps/desktop/.env.example) → `apps/desktop/.env`. Vite only
exposes `VITE_`/`TAURI_` prefixes (`envPrefix` in [vite.config.ts](../apps/desktop/vite.config.ts)).

### Runtime data locations
Under the Tauri app-data dir (`app.path().app_data_dir()`,
[lib.rs:44](../apps/desktop/src-tauri/src/lib.rs)) — on Windows
`%APPDATA%\com.naimul.music-vault\`:

| Path | Contents |
|---|---|
| `library.db` | SQLite (WAL) |
| `logs/music-vault.log` | Daily-rotating `tracing` log ([lib.rs:47-49](../apps/desktop/src-tauri/src/lib.rs)) |
| `artwork/` | Covers fetched from the vault, `vault-<sha>.jpg` + `.thumb.jpg` (the only path the webview may read — asset scope) |
| `audio-cache/` | Auto-cache tier (LRU-evicted) |
| `downloads/` | Pinned tier (never auto-evicted), unless Downloads → Download folder moved it: the `settings` row `downloads_dir` then holds the folder |

Log verbosity: `RUST_LOG` (default `info,music_vault_lib=debug`,
[lib.rs:52-54](../apps/desktop/src-tauri/src/lib.rs)).

---

## 4. Android

### Build & install
```sh
cd apps/android
./gradlew.bat :app:assembleDebug        # Windows; use ./gradlew elsewhere
./gradlew.bat installDebug              # to a connected device/emulator
./gradlew.bat testDebugUnitTest         # JVM unit tests
```

No NDK is needed: the one native library of our own, `libffmpegJNI.so` (FFmpeg's APE and WavPack
decoders), is prebuilt under `apps/android/ffmpeg/src/main/jniLibs`. To rebuild it, see
[apps/android/ffmpeg/README.md](../apps/android/ffmpeg/README.md).

### Debug vs release
- **Debug** — no minification; signed with the debug keystore. This is what CI builds, since the
  release key never leaves the owner's machine ([release.yml](../.github/workflows/release.yml)).
- **Release** (since 2026-10-15) — no R8 (`isMinifyEnabled = false`; Hilt, serialization and the
  Supabase client rely on reflection), signed with the key that `signing.properties` in
  `local.properties` names; without that line the APK is unsigned
  ([build.gradle.kts](../apps/android/app/build.gradle.kts),
  [apps/android/README.md](../apps/android/README.md#release-apk)).

### Credentials
Create `apps/android/local.properties` (git-ignored):
```properties
supabase.url=https://YOUR-PROJECT.supabase.co
supabase.anonKey=YOUR-ANON-KEY
```
Each key falls back to an env var — `local.properties` first, then `SUPABASE_URL` /
`SUPABASE_ANON_KEY`, then `""` ([build.gradle.kts:19-20](../apps/android/app/build.gradle.kts)).
Values are injected as `BuildConfig` fields.

**Emulator tip**: start it with `-no-snapshot-load -no-snapshot-save`. Restoring a snapshot
reverts the app's saved session to one whose refresh token was already used, which signs you out
at every launch.

---

## 5. Web

```sh
npm run web:dev              # next dev → http://localhost:3000
npm run web:build            # next build
npm run web:typecheck        # tsc --noEmit
npm run web:lint             # oxlint src
npm run web:e2e              # playwright test
```

Copy [apps/web/.env.example](../apps/web/.env.example) → `apps/web/.env.local`.

**A build needs Supabase values present** — CI supplies dummies for exactly this reason:
"Dummy values so the build succeeds without project secrets; a real deployment gets these from
Vercel env settings" ([ci.yml](../.github/workflows/ci.yml)).

### Deploy (Vercel)
Vercel builds previews per push once the repo is linked ([README.md:69-70](../README.md)). There is
no `vercel.json` in the repo — configuration is done in the Vercel dashboard. Set every variable
from [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md#web--appswebenvlocal) there (just the
two Supabase values), and add the deployment origin to the R2 bucket's CORS policy
([docs/vault-setup.md](../docs/vault-setup.md) § 5) or uploads and playback fail in the browser.

---

## 6. Supabase

1. Create a project at supabase.com.
2. Apply the migrations **in order**, by hand, in the SQL editor (or psql):
   `0001_init.sql` → `0002_track_identity_upsert.sql` → `0003_sync.sql` → `0004_vault.sql` →
   `0005_drop_drive.sql`.
   ⚠️ There is **no Supabase CLI config or migration runner in this repo** — no `config.toml`.
   The RLS test's own header confirms the workflow: "run in the Supabase SQL editor (or psql)"
   ([tests/rls_smoke.sql:1-3](../supabase/tests/rls_smoke.sql)).
3. Optionally verify: run [supabase/tests/rls_smoke.sql](../supabase/tests/rls_smoke.sql) and
   [supabase/tests/vault_smoke.sql](../supabase/tests/vault_smoke.sql) (both roll back).
4. Copy **Project URL** and **anon key** (Settings → API) into each client's env.

Migration 0003 also adds tables to the `supabase_realtime` publication — Realtime works with no
dashboard changes.

Full walkthrough: [docs/setup-supabase.md](../docs/setup-supabase.md).

## 7. The vault (Cloudflare R2 + the `vault` Edge Function)

1. Create the private R2 bucket `musicvault`, its CORS policy (the web origins, GET/PUT/HEAD) and
   an API token scoped to that bucket — [docs/vault-setup.md](../docs/vault-setup.md) § 1–7.
2. Store `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` as Supabase
   Edge Function secrets (§ 8). The keys never go in any app or `.env` file.
3. Deploy [supabase/functions/vault/](../supabase/functions/vault) with JWT verification on.
4. Check it end to end with `node supabase/functions/vault/smoke.mjs` — it signs in as you
   (password from a hidden prompt), uploads a temporary track, downloads, edits and deletes it.

Details: [VAULT.md](VAULT.md).

---

## 8. Tests

```sh
npm run core:test                                  # vitest — core suites
npm run vault:test                                 # vitest — the vault function handler
npm run web:e2e                                    # Playwright
cd apps/desktop/src-tauri && cargo test            # Rust
cd apps/android && ./gradlew.bat testDebugUnitTest # JVM
```
Details, including the two environment-sensitive tests, in [TESTING.md](TESTING.md).

---

## 9. CI/CD

### [ci.yml](../.github/workflows/ci.yml) — push/PR to `main`
Four jobs, with `concurrency: cancel-in-progress`:

| Job | Runner | Does |
|---|---|---|
| `typescript` | ubuntu | `npm ci`; core typecheck+test; vault function typecheck+test; desktop lint+typecheck; web lint+typecheck+**build** (with dummy Supabase env) |
| `web-e2e` | ubuntu | Playwright chromium, `CI: "true"`; authenticated specs skip without `E2E_EMAIL`/`E2E_PASSWORD` |
| `rust` | **windows** | Builds the desktop frontend **first** — "the frontend dist must exist first: `tauri::generate_context!` embeds it at compile time" — then `cargo test -- --skip plays_hires_tone_through_default_device` because "CI runners have no audio output device" |
| `android` | ubuntu | JDK 17 + `./gradlew testDebugUnitTest` ("JVM only — no emulator on CI") |

### [release.yml](../.github/workflows/release.yml) — manual dispatch only (since 2026-10-15)
| Job | Produces |
|---|---|
| `windows-installer` | NSIS `.exe` → artifact `music-vault-windows-installer`; attached to the release when run on a tag |
| `android-apk` | Debug `.apk` → artifact `music-vault-android-apk`; attached when run on a tag |

Both jobs read repository secrets that a usable build needs — "Music Vault needs an account, so a
build without them can't reach the library". Desktop reads `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`; Android reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`. **These are baked
into the artifact at build time.**

---

## 10. Gotchas

| Symptom | Cause |
|---|---|
| `cargo test`/`tauri build` fails on a missing dist | `generate_context!` embeds the frontend at compile time — run the frontend build first (CI does exactly this) |
| EBUSY / file-lock churn in dev | Vite ignores `**/src-tauri/**` for this reason; don't remove it |
| Web build fails without secrets | Supply dummy `NEXT_PUBLIC_SUPABASE_*` as CI does |
| "This build has none configured" | The Supabase URL / anon key weren't set at build time |
| Web upload/playback CORS error | The origin isn't in the R2 bucket's CORS policy |
| Vault calls fail with `internal` | Missing or wrong R2 secrets in Supabase — check the function logs |

More in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
