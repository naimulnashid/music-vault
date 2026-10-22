# Troubleshooting

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; Google Drive and local-folder entries
> replaced 2026-10-13 by the vault's.
> Issues below are grounded in the repository — code comments, CI workarounds, `.env.example`
> notes, the setup docs, and fixes visible in the commit history. Where an item is **inferred**
> from a constraint rather than observed as a reported bug, it says so.
> Setup: [BUILD_AND_RUN.md](BUILD_AND_RUN.md) · Variables: [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).

## First: where the evidence is

| Client | Diagnostics |
|---|---|
| Desktop | `<app-data>\logs\music-vault.log` (daily rotation) **and** stderr; verbosity via `RUST_LOG` ([lib.rs:47-61](../apps/desktop/src-tauri/src/lib.rs)). Startup profile: the `setup done` line with `total_ms`/`db_ms`/`engine_ms` ([lib.rs:129-134](../apps/desktop/src-tauri/src/lib.rs)) |
| Android | logcat (Timber) |
| Web | browser console; `[startup]` lines in the renderer |
| Vault | Supabase dashboard → Edge Functions → `vault` → Logs; the client error carries the function's `code` |
| Sync (all) | **Breadcrumbs** — `cycle.start`, `cycle.end`, `flush.coalesced`, `flush.opFailed`, `flush.conflictLost`, `pull.applied`, `enqueue.dropped`, `realtime.hint` ([core/sync/types.ts:213-230](../packages/core/src/sync/types.ts)); see [docs/sync-protocol.md](../docs/sync-protocol.md) § Diagnostics |

`%APPDATA%\com.naimul.music-vault\` holds `library.db`, `logs/`, `artwork/`, `audio-cache/`,
`downloads/` (unless Downloads → Download folder moved the downloads elsewhere).

---

## The vault (uploads, downloads, deletes)

The `vault` function answers errors as `{ error: <code>, message }` with an HTTP status
([handler.ts](../supabase/functions/vault/handler.ts)); the apps show the message.

| Code | Status | Meaning / fix |
|---|---|---|
| `unauthorized` | 401 | No or expired Supabase session — sign in again |
| `track_not_found` | 404 | The row isn't the caller's, or was removed meanwhile |
| `no_hash` | 409 | The row has no content hash (should not happen for an upload) |
| `too_large` | 413 | Audio over 2 GiB or a cover over 5 MiB |
| `not_uploaded` | 409 | `commit` found no object — the PUT never finished; upload again |
| `size_mismatch` | 409 | The object's size differs from the row's `file_size`; it was deleted — upload again |
| `bad_request`, `unknown_action`, `method_not_allowed` | 400/405 | A client/function version mismatch — update the app |
| `internal` | 500 | "Vault request failed" — usually missing or wrong R2 secrets; check the function logs and [docs/vault-setup.md](../docs/vault-setup.md) § 8 |

### Web upload or playback fails with a CORS error
**Cause**: the R2 bucket's CORS policy doesn't list this origin. Bytes go from the browser straight
to R2, so the bucket — not Vercel — must allow it.
**Fix**: add the origin (e.g. `http://localhost:3000`, the Vercel URL) for GET, PUT and HEAD —
[docs/vault-setup.md](../docs/vault-setup.md) § 5. ⚠️ Vercel preview deployments get unique URLs;
each must be listed to work.

### `403` from R2 on a PUT or GET
**Cause**: the signed URL expired — PUT links live 15 minutes, GET links 1 hour. Clients cache GET
links until two minutes before expiry and re-sign after that.
**Fix**: retry; the app asks for a fresh link. A persistent 403 on every request points at a
revoked or wrong R2 token in the Supabase secrets.

### "Already in your vault"
**Expected**: the file's BLAKE3 matches a track you already have, so nothing is uploaded. A
re-upload of a track you deleted brings it back (its details from the form are applied after the
commit).

### A key comes back as `denied` / a track won't play
`sign-get` only signs keys a **live** row of the caller references. A track deleted on another
device stays visible here until this device pulls the tombstone; the next sync removes it and its
downloaded copy.

### A download is rejected (hash mismatch)
**By design**: every client checks downloaded bytes against the track's BLAKE3 and never keeps a
mismatch ([vault/transfer.rs](../apps/desktop/src-tauri/src/vault/transfer.rs),
[audioCache.ts](../apps/web/src/lib/audioCache.ts), Android pinned downloads). Retry; a repeat
points at a corrupted object — upload the file again.

### The library was empty after updating to the vault build
**Expected once**: the vault build reset every device's library (desktop SQLite v9, Room v7, the
web's `freshStart`) and the server was wiped, so the library is rebuilt from uploads
([docs/drive-to-r2-migration.md](../docs/drive-to-r2-migration.md), decision 8). Settings were
kept.

### A song uploaded from Android has no ReplayGain
**Expected**: JAudioTagger can't read ReplayGain tags, and technical fields are read-only after
upload. Upload the file from desktop or web to keep them.

---

## Supabase

### "Music Vault needs an account, and this build has none configured"
**Cause**: the build has no Supabase URL / anon key (`resolveSupabaseConfig` returned null). There
is no local mode any more — the library lives in the vault.
**Fix**: set the URL + anon key for that client and rebuild (they're compile-time on Android and
build-time-inlined on web and desktop).

### Web pages load but signed-out users aren't redirected
**Cause**: with Supabase env missing, [proxy.ts:22-25](../apps/web/src/proxy.ts) returns early —
"Unconfigured deployment: let the pages render their own notice" — so **route protection is off**.
**Fix**: configure Supabase properly; don't run a half-configured deployment.

### Queries return nothing though rows exist
**Cause**: RLS. Every policy is `user_id = auth.uid()` ([DATABASE.md §1.5](DATABASE.md#15-row-level-security)).
**Check**: you're querying as the owning user; verify with
[supabase/tests/rls_smoke.sql](../supabase/tests/rls_smoke.sql).

### `ON CONFLICT` / upsert errors mentioning no unique constraint
**Cause**: migration **0002** and/or **0003** wasn't applied. 0002 converts the `tracks` partial
unique indexes to full ones because "PostgREST cannot infer partial unique indexes for upsert"
([0002_track_identity_upsert.sql:1-5](../supabase/migrations/0002_track_identity_upsert.sql)); 0003
adds `playlist_items_playlist_track_key`, which "gives PostgREST upserts their conflict target"
([0003_sync.sql:48-50](../supabase/migrations/0003_sync.sql)).
**Fix**: apply 0001 → 0005 **in order**. There is no migration runner; this is manual.

### `check constraint "tracks_identity"` violation
**Cause**: a live row without a `content_hash`
([0005_drop_drive.sql](../supabase/migrations/0005_drop_drive.sql)). Client-side,
`trackRefHasIdentity` guards this and the engine drops such ops (breadcrumb `enqueue.dropped`).

### A direct write to `storage_key` / `deleted_at` "doesn't stick"
**By design**: the `tracks_protect_vault_columns` trigger ignores client writes to the vault
columns; only the `vault` function and the SQL functions set them
([0004_vault.sql](../supabase/migrations/0004_vault.sql)).

### Un-favoriting or clearing a rating doesn't reach other devices
**Cause**: pre-0003 semantics. Deletions are invisible to `updated_at` cursors, which is why
favorites became soft state (`favorite = false`) and ratings allow `0`
([0003_sync.sql:9-11, 25-26](../supabase/migrations/0003_sync.sql)).
**Fix**: apply 0003.

### Realtime changes don't arrive
**Cause**: the publication is added by **0003** ([:81-89](../supabase/migrations/0003_sync.sql)).
**Note**: Realtime is only a "pull sooner" hint — sync still converges on the next cursor pull, so
this degrades quietly rather than breaking.

---

## Tauri / Rust / Windows

### `cargo test` or `tauri build` fails to compile on a clean checkout
**Cause**: `tauri::generate_context!` **embeds the frontend dist at compile time** — CI documents
this: "The frontend dist must exist first" ([ci.yml](../.github/workflows/ci.yml)).
**Fix**: `npm run build -w music-vault-desktop` first.

### `cargo test` fails on `plays_hires_tone_through_default_device`
**Cause**: no audio output device (headless VM, RDP, CI).
**Fix**: `cargo test -- --skip plays_hires_tone_through_default_device` — exactly what CI does.

### EBUSY / file-lock errors during `tauri dev`
**Cause**: Vite watching cargo's output. The config already excludes it — "Don't watch the Rust
build output — cargo holds locks on it (EBUSY)" ([vite.config.ts](../apps/desktop/vite.config.ts)).
**Fix**: don't remove that `ignored` entry.

### Port 1420 in use
`strictPort: true` means Vite fails rather than picking another port
([vite.config.ts](../apps/desktop/vite.config.ts)) — Tauri's `devUrl` is hard-coded to 1420.
**Fix**: free the port.

### Black screen / app auto-closes on startup
**A real, fixed bug**: `62a4e1b` "fix(desktop): jump list crash on startup (black screen,
auto-close)". If seen on an older build, update. The jump list is now warn-and-continue
([lib.rs:122-125](../apps/desktop/src-tauri/src/lib.rs)).

### No media keys / no tray icon
**By design, non-fatal.** SMTC: "Media keys are non-essential; run without them"
([lib.rs:110-114](../apps/desktop/src-tauri/src/lib.rs)). Tray: "The app is fully usable without a
tray icon" ([lib.rs:117-120](../apps/desktop/src-tauri/src/lib.rs)). Look for `SMTC unavailable` /
`tray unavailable` / `jump list unavailable` warnings in the log.

### Main window vanished after using the mini player
**Expected**: opening mini **hides** main ([commands/window.rs:33-36](../apps/desktop/src-tauri/src/commands/window.rs)).
Closing mini restores it via the `Destroyed` handler ([lib.rs:194-202](../apps/desktop/src-tauri/src/lib.rs)).
If main is stuck hidden, relaunching the app focuses whichever window exists
([lib.rs:32-39](../apps/desktop/src-tauri/src/lib.rs)).

### Artwork doesn't render
**Cause**: the asset protocol is scoped to `$APPDATA/artwork/**`
([tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json)). Art outside that directory is
unreadable by the webview **by design**.

### Covers missing on tracks that aren't downloaded
Covers are fetched by key from the vault after each sync (`fetchVaultArt`,
[lib/vault.ts](../apps/desktop/src/lib/vault.ts)) into `artwork/vault-<sha>.jpg`. Missing art
usually means the device was offline when the rows arrived; it fills in on the next sync.

### Release build is very slow
**Expected**: `lto = true`, `codegen-units = 1` ([Cargo.toml](../apps/desktop/src-tauri/Cargo.toml)).
Use `tauri dev` for iteration.

---

## Android / Gradle

### `Unresolved reference: BuildConfig` or empty `SUPABASE_URL`
**Cause**: `buildConfig = true` is set ([build.gradle.kts](../apps/android/app/build.gradle.kts)),
but the **values** come from `local.properties`/env at configure time. Missing → `""` → the app
shows that no account is configured.
**Fix**: create `apps/android/local.properties` and re-sync/rebuild.

### Gradle OOM or slow builds
`org.gradle.jvmargs=-Xmx4096m` with caching and parallel enabled
([gradle.properties](../apps/android/gradle.properties)). ⚠️ **Inferred**: KSP + Hilt + Compose on a
4 GB heap is tight on small machines; raise `-Xmx` if the daemon OOMs.

### Wrong JDK
JDK **17** is required — `sourceCompatibility`/`targetCompatibility = VERSION_17`, `jvmTarget = "17"`
([build.gradle.kts:53-58](../apps/android/app/build.gradle.kts)); CI pins temurin 17. A newer JDK on
`JAVA_HOME` is the usual culprit for cryptic Gradle failures. ⚠️ Inferred from the pinning.

### `assembleRelease` produces an unsigned APK
**Expected** when `local.properties` has no `signing.properties=` line naming the release key
([apps/android/README.md](../apps/android/README.md#release-apk)). CI builds debug only.

### Release build crashes but debug works
**Unlikely since 2026-10-15**: release builds no longer run R8, so they execute the same code
as debug. If minification is ever turned back on, reflection-based paths (kotlinx-serialization,
Room, Hilt) need keep rules in [proguard-rules.pro](../apps/android/app/proguard-rules.pro).

### Room `IllegalStateException: migration didn't properly handle`
**Cause**: adding/altering an entity without a matching `Migration`. Room is at **v7** with six
migrations ([MusicVaultDatabase.kt](../apps/android/app/src/main/java/com/musicvault/data/db/MusicVaultDatabase.kt)).
⚠️ `exportSchema = false` and **no migration tests exist** ([TESTING.md](TESTING.md#4-android-suite--64-cases)),
so this fails at runtime rather than in CI. Bump `version` **and** add a `MIGRATION_n_n+1`.

### Android emulator: signed out at every launch ("Invalid Refresh Token: Already Used")
**Cause**: the emulator restored a snapshot, reverting app data to an older session whose refresh
token the server has already rotated. Not an app bug.
**Fix**: start the emulator with `-no-snapshot-load -no-snapshot-save` (or a cold boot), then sign
in once.

### Android: crash at startup in Hilt injection (`lateinit property workerFactory`)
**A real, fixed bug**: anything injected into the `Application` must not touch WorkManager while
it's being constructed. `DownloadRepository.activeWork` is lazy and `SyncManager` takes
`dagger.Lazy<DownloadRepository>` for that reason.

---

## Node / npm / web / Vercel

### `next build` fails without secrets
**Cause**: Supabase env is needed at build time. CI injects dummies — "Dummy values so the build
succeeds without project secrets; a real deployment gets these from Vercel env settings"
([ci.yml](../.github/workflows/ci.yml)).
**Fix**: do the same locally, or provide real values.

### `Cannot find module '@musicvault/core'` / TS errors from core
**Cause**: core ships **raw TypeScript with no build step** — `main`/`types` point at
`./src/index.ts` ([packages/core/package.json](../packages/core/package.json)). Consumers compile it:
web needs `transpilePackages: ["@musicvault/core"]` ([next.config.ts](../apps/web/next.config.ts)).
**Fix**: run `npm install` at the **root** (workspaces link it); never install inside `apps/*`.

### Playwright can't start / port conflicts
E2E uses **port 3100**, not 3000 ([playwright.config.ts:37](../apps/web/playwright.config.ts)), and
`reuseExistingServer: !CI`. Server start timeout is 180 s.

### Authenticated e2e specs all skip
**Expected** without `E2E_EMAIL`/`E2E_PASSWORD`
([authenticated.spec.ts:14](../apps/web/e2e/authenticated.spec.ts)).

### Vercel deployment works but uploads/playback fail
Vercel needs only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Check the R2
CORS policy lists the deployment's origin (see [The vault](#the-vault-uploads-downloads-deletes)).
There is no `vercel.json` — all configuration is dashboard-side.

### Node version
CI uses Node **22**; the README says "Node 20.19+ or 22.12+" ([README.md](../README.md)), the floor Vite 8 and Next 16 set. Prefer 22 to match CI.

---

## Sync

### Changes don't propagate between devices
Work down this list:
1. Both devices signed in to the **same** Supabase project? (Env values, not just "signed in".)
2. Breadcrumbs — `cycle.end` reached? `flush.opFailed`? `enqueue.dropped` means the op had no
   durable track identity and was **never queued**.
3. Pending ops persist across restarts by design (the outbox survives crashes); a growing
   `pendingOps` with no `cycle.end` means flushes are failing.
4. Migration 0003 applied? Without `edited_at` the LWW comparison has nothing to compare.

### A change "reverted"
**Probably correct behavior**: last-writer-wins on `edited_at`. The engine emits
`flush.conflictLost` when a local op lost — the suite pins this ("rating conflict: the later edit
wins **regardless of flush order**", [syncEngine.test.ts:381](../packages/core/tests/syncEngine.test.ts)).
Clock skew between devices is the real hazard, since `edited_at` is a **client** clock.

### Clearing the queue didn't stick / came back from another device
**A real, fixed bug** — three commits: `5423e5b` (desktop), `f381eb5` (web), `a1247c0`
(propagation). Regression-tested by "an empty queue.set clears the handoff row and reaches the other
device" ([syncEngine.test.ts:404](../packages/core/tests/syncEngine.test.ts)).

### Listening history survived sign-out
**Intentional.** The play-event log is device-owned and "deliberately NOT wiped on sign-out, unlike
sync_*" ([db/mod.rs:188-193](../apps/desktop/src-tauri/src/db/mod.rs));
`sync_clear_all` doesn't touch `play_events`
([commands/sync.rs:81](../apps/desktop/src-tauri/src/commands/sync.rs)).

### Stats differ between devices
Expected transiently: each device shows its **local log ∪ synced shadow**, deduped by event id
([core/stats.ts:103](../packages/core/src/stats.ts)).

---

## Cross-cutting

| Symptom | Likely cause |
|---|---|
| A feature exists on one client but not another | Often intended — check [FEATURE_PARITY.md](FEATURE_PARITY.md) before debugging |
| Custom hex accent ignored on Android | By design: "Clients that only understand presets fall back to their default accent" ([core/types.ts:64-69](../packages/core/src/types.ts)) |
| ReplayGain has no audible effect off desktop | By design: "synced; only desktop applies it" ([core/types.ts:96-97](../packages/core/src/types.ts)) |
| Library empty on every client | Nothing uploaded yet — the library is the vault ([VAULT.md](VAULT.md)) |
| Mini player/tray missing off desktop | Desktop-only features |
| Android durations look 1000× off | The Android `Track` model uses `durationMs`; core/desktop use seconds ([DATABASE.md §3.3](DATABASE.md#33-structural-differences-from-desktop-sqlite)) |
