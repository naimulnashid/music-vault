# Developer Guide

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; updated 2026-10-13 for the vault.
> Conventions below are **observed from the code**, not prescribed by me — this repo has no
> CONTRIBUTING.md, no Prettier/EditorConfig, and no ktlint/rustfmt config. The patterns are
> nonetheless remarkably consistent, so follow what's there.
> Setup first: [BUILD_AND_RUN.md](BUILD_AND_RUN.md).

## Project philosophy

Four principles are stated at [docs/architecture.md:22-32](../docs/architecture.md) and hold up under
inspection:

1. **Offline-first.** "Every client works fully offline; cloud state is a sync target, not a
   dependency."
2. **Audio never streams twice.** Play a cloud track once → it's local forever.
3. **Supabase stores the details, the vault stores the bytes.** Track details are edited online;
   R2 holds audio and covers, reached only through signed URLs from the `vault` function.
4. **Replaceable components.** ⚠️ True at module boundaries, in the sync engine and for storage
   (any S3-compatible bucket behind the one function); **not** true of the audio output, despite the
   docs — see
   [ADR-011](ARCHITECTURE_DECISIONS.md#adr-011-replaceable-components-aspirational-in-two-places).

A fifth, unwritten but pervasive: **push invariants into the layer that cannot forget them** —
a check constraint for identity, RLS policies for append-only, fractional indexes for merge safety,
injected clocks for determinism.

## The one rule that matters most

> **Change shared semantics in lockstep or not at all.**

Said three times in three places: [core/smartRules.ts:6-8](../packages/core/src/smartRules.ts),
[docs/architecture.md:57-58](../docs/architecture.md), and the fixtures' own `$comment`. If you
break this, nothing fails loudly — the clients simply disagree, and users see a playlist with
different contents on their phone.

---

## Coding conventions

### Comments explain *why*, never *what*
This is the strongest convention in the codebase and the reason this audit could cite rationale so
often. Comments justify non-obvious decisions:

```rust
// Google Drive and local-folder libraries are retired, and the library
// was rebuilt from scratch online (docs/drive-to-r2-migration.md,
// decision 8). Drop their tables and clear everything that described
// the old library — playlists, play history, sync state, cached audio —
// so nothing stale syncs back. Device settings stay.
```
([db/mod.rs:253-257](../apps/desktop/src-tauri/src/db/mod.rs))

Match this. A comment restating the code will look out of place; a comment explaining why the
obvious approach was rejected is the house style.

### TypeScript
- **Strict everything** — `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`, ES2022, `moduleResolution: "bundler"`
  ([packages/core/tsconfig.json](../packages/core/tsconfig.json)).
- **Lint**: `oxlint` (not ESLint). Only two rules are configured beyond defaults —
  `react/rules-of-hooks: error`, `react/only-export-components: warn`
  ([.oxlintrc.json](../apps/desktop/.oxlintrc.json)).
- **Style**: double quotes, semicolons, 2-space indent, ~100-col wrapping, `type` imports
  (`import type { … }`), discriminated unions over class hierarchies (`SyncOpPayload`), exhaustive
  `switch` on the discriminant with no `default` — so adding a kind is a **compile error**
  ([core/sync/types.ts:114-136](../packages/core/src/sync/types.ts)). Keep that.
- **Exports**: everything flows through [packages/core/src/index.ts](../packages/core/src/index.ts);
  add your `export *` there.
- **Core is source-only** — no build step, `main`/`types` → `src/index.ts`. Never add a bundler to it
  without also fixing `transpilePackages` on web.

### Rust
- Modules mirror domains: `audio/`, `db/`, `vault/`, `scan/`, `commands/`. `commands/` is split by
  domain and mirrors the frontend's stores.
- `//!` module headers explain the module's *strategy* — see
  [vault/cache.rs:1-5](../apps/desktop/src-tauri/src/vault/cache.rs) or
  [vault/transfer.rs:1-3](../apps/desktop/src-tauri/src/vault/transfer.rs). Write one for any new module.
- Commands return `Result<T, String>`; internals use `AppResult`/`anyhow`. Convert at the boundary
  with `.map_err(|e| e.to_string())`.
- Response structs: `#[derive(Serialize)] #[serde(rename_all = "camelCase")]`.
- Non-essential subsystems **warn and continue**, never panic:
  ```rust
  Err(e) => { tracing::warn!(error = %e, "SMTC unavailable"); … }
  ```
  ([lib.rs:110-125](../apps/desktop/src-tauri/src/lib.rs)). Apply this to anything the app can live
  without.
- Logging is structured `tracing` with fields (`tracing::info!(path = %db_path.display(), "database opened")`).

### Kotlin
- Clean architecture, already in place: `domain/` (pure) → `data/` (repos, Room, network) →
  `ui/` (Compose + ViewModels), wired by Hilt (`di/`).
- Repositories are `@Singleton class … @Inject constructor(…)`; reads expose `Flow`, writes are
  `suspend fun`.
- `domain/` files that mirror `packages/core` must stay 1:1 — treat them as generated-by-hand.
- Versions go in the catalog ([libs.versions.toml](../apps/android/gradle/libs.versions.toml)), never
  inline in `build.gradle.kts`.

### Naming across the boundary
Rust `snake_case` → JS `camelCase` (Tauri converts); Supabase columns are `snake_case`; Room is
`camelCase`. Beware the deliberate inconsistencies documented in
[DATABASE.md §3.3](DATABASE.md#33-structural-differences-from-desktop-sqlite): Room stores
`durationMs` (**milliseconds**) where core and desktop use **seconds**, and ReplayGain columns are
named three different ways.

### Commits
Conventional-commit style with a scope, imperative mood, lowercase after the colon:
```
feat(vault): M7 — drop the Drive columns; tracks are known by content hash
fix(web): clearing the queue also clears the saved resume point
fix(vault): edits after commit on re-upload; drop local copies of deleted tracks
docs(vault): M8 — README, architecture and setup guides describe the vault
```
Scopes in use: `desktop`, `web`, `android`, `sync`, `vault`, `ui`, plus bare `docs`. During the build-out, commits were
`Phase 8c: <summary>` — that convention is finished; use the conventional form.

---

## Folder organization

Where new code goes ([REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md) has the full map):

| You're adding… | Put it in |
|---|---|
| Logic shared by desktop + web | `packages/core/src/` (+ export from `index.ts`) |
| Logic also needed on Android | …and hand-port to `apps/android/.../domain/` (+ fixture) |
| A desktop native capability | `src-tauri/src/<domain>/` + a command in `src-tauri/src/commands/<domain>.rs` |
| A desktop/web view | `src/components/`, state in `src/store/`, IO in `src/lib/` |
| An Android screen | `ui/screens/`, ViewModel in `ui/`, data access via `data/repo/` |
| Anything that needs the R2 keys | The `vault` Edge Function ([supabase/functions/vault/](../supabase/functions/vault)) — never a client |

---

## How to add a feature

### …a Tauri command
1. Implement in the right `src-tauri/src/<domain>/` module.
2. Add a thin `#[tauri::command]` in `commands/<domain>.rs` — commands should orchestrate, not
   contain logic. Compare [commands/vault.rs](../apps/desktop/src-tauri/src/commands/vault.rs)
   (spawns, delegates) with `vault/prepare.rs` (does the work).
3. **Register it in the `invoke_handler` list** at [lib.rs:121-171](../apps/desktop/src-tauri/src/lib.rs).
   Forgetting this is the classic mistake — it compiles and fails at runtime.
4. Add the typed wrapper in [src/lib/ipc.ts](../apps/desktop/src/lib/ipc.ts).
5. Long work → `spawn_blocking` (as `vault_prepare_files` does) so the UI thread stays free.

### …a vault action or editable track field
- A new function action goes in [handler.ts](../supabase/functions/vault/handler.ts) with cases in
  `handler.test.ts`, then the core client ([core/vault.ts](../packages/core/src/vault.ts)) and the
  Android `VaultApi.kt`.
- A new editable field touches `EDITABLE_TRACK_FIELDS` in
  [core/trackFields.ts](../packages/core/src/trackFields.ts), `apply_track_edit` (a new migration),
  the Kotlin `TrackEdit`, the three editors and
  [track-edit.golden.json](../docs/fixtures/track-edit.golden.json) — in one commit.
- Storage itself is swappable: any S3-compatible bucket works by changing the function's endpoint
  and secrets; clients never see the provider.

### …a playback engine
There are three, they are independent, and that is [ADR-001](ARCHITECTURE_DECISIONS.md#adr-001-reuse-three-mature-apps-rather-than-rewrite)
working as intended. There is **no** output trait ([ADR-011](ARCHITECTURE_DECISIONS.md#adr-011-replaceable-components-aspirational-in-two-places)) —
adding a WASAPI-Exclusive backend means extracting one from the concrete `Output` struct
([audio/output.rs:22](../apps/desktop/src-tauri/src/audio/output.rs)) first. Any change to
transport semantics must be made three times; the queue-clear bug (`5423e5b`, `f381eb5`, `a1247c0`)
is the cautionary tale.

### …a smart-playlist rule field or operator
Four files, one commit:
1. `RuleField` / `RuleOp` + the evaluator in [core/smartRules.ts](../packages/core/src/smartRules.ts).
2. The Kotlin port [SmartRules.kt](../apps/android/app/src/main/java/com/musicvault/domain/SmartRules.kt)
   (+ `SmartRulesMeta.kt` for editor metadata).
3. Cases in [docs/fixtures/smart-rules.golden.json](../docs/fixtures/smart-rules.golden.json).
4. The `SmartRulesEditor` on all three clients.

Keep `RuleTrackInput` platform-neutral — duration in **seconds**, timestamps in **epoch ms**, rating
**0 = unrated** ([docs/architecture.md:56-59](../docs/architecture.md)). No storage change is needed:
the AST is stored verbatim as JSON.

### …a sync op kind
1. Add to the `SyncOpPayload` union ([core/sync/types.ts:64-97](../packages/core/src/sync/types.ts)).
2. The compiler now tells you where to go — `opEntityKey` and `opEditedAt` switch exhaustively with
   no `default`. **Coalescing is decided by `opEntityKey`**: same key = same LWW row, only the newest
   flushes. If your op is append-only, return a per-op key like `playEvent.add` does.
3. Handle flush/pull in [engine.ts](../packages/core/src/sync/engine.ts) and extend `SyncTransport`.
4. Implement the transport method for **both** Supabase transports (TS and Kotlin).
5. Port to [SyncEngine.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/SyncEngine.kt).
6. Add cases to [syncEngine.test.ts](../packages/core/tests/syncEngine.test.ts) **and**
   [SyncEngineTest.kt](../apps/android/app/src/test/java/com/musicvault/data/sync/SyncEngineTest.kt).

Rules that are not optional: every op needs a client-generated id (idempotency); LWW needs
`edited_at`; a `TrackRef` without a durable identity **must not be enqueued**
([core/sync/types.ts:9-11](../packages/core/src/sync/types.ts)).

### …a database migration

**Desktop (SQLite)** — [db/mod.rs](../apps/desktop/src-tauri/src/db/mod.rs):
1. Bump `SCHEMA_VERSION` ([:16](../apps/desktop/src-tauri/src/db/mod.rs)).
2. Append an `if version < N { … PRAGMA user_version = N; }` block — never edit an existing one.
3. Comment **why**, with the phase, as every existing block does.
4. Backfill in the same block when a column needs a baseline — v7 does exactly this so existing
   downloads aren't all treated as stale ([:226-234](../apps/desktop/src-tauri/src/db/mod.rs)).
5. Extend the migration test ([:260](../apps/desktop/src-tauri/src/db/mod.rs)) — assert the
   *behavior* you changed, as v4 and v8 do.

**Android (Room)** — [MusicVaultDatabase.kt](../apps/android/app/src/main/java/com/musicvault/data/db/MusicVaultDatabase.kt):
bump `version`, add `MIGRATION_n_n+1`, register it. ⚠️ `exportSchema = false` and no migration tests
exist — a mistake surfaces as a runtime crash on real users' devices, not in CI. Test by hand.

**Supabase** — add `supabase/migrations/000N_*.sql`. Remember:
- deletes are invisible to cursors → prefer soft state
  ([ADR-006](ARCHITECTURE_DECISIONS.md#adr-006-soft-state-instead-of-deletes));
- upserts need a **full** unique index or constraint as a conflict target
  ([ADR-005 context](DATABASE.md#why-0002-exists));
- new synced tables need RLS **and** the Realtime publication;
- there is no runner — someone applies it by hand, so make it re-runnable-safe and say so.

### …a new screen
- Desktop/web: component in `components/`, state in `store/`, register in `App.tsx` /
  `MusicVaultApp.tsx`, add sidebar entry. Web: make heavy views lazy chunks — stats, recap,
  downloads, EQ and visualizer already are
  ([docs/architecture.md:156-157](../docs/architecture.md)).
- Android: `ui/screens/`, ViewModel in `ui/`, route in `AppRoot.kt`/`VaultDrawer.kt`.
- Long track lists must window: use `useVirtualRows` (desktop/web); Compose's lazy lists on Android.

---

## How to write tests

The strategy, in one line: **pure logic is tested exhaustively; I/O boundaries are not tested at
all.** Full picture in [TESTING.md](TESTING.md).

| Kind | Where | Notes |
|---|---|---|
| Shared logic | `packages/core/tests/*.test.ts` | vitest; if it has a Kotlin port, update port + fixture in the same commit |
| Rust | inline `#[cfg(test)] mod tests` | **Name the test after the invariant**, e.g. `enforce_cap_evicts_least_recently_used_first_and_spares_pinned` |
| Android | `app/src/test/java/…` | JUnit 4 + Truth; JVM-only, no framework deps |
| Web flows | `apps/web/e2e/` | Put anything needing an account behind the `E2E_EMAIL`/`E2E_PASSWORD` skip |

**Make it deterministic by construction.** The engine injects `now`/`uuid` and `autoSync: false`
so tests drive `syncNow()` ([core/sync/engine.ts:28-41](../packages/core/src/sync/engine.ts)); stats
inject a `fixedOffsetZone` ([core/stats.ts:47-53](../packages/core/src/stats.ts)); fixtures pin
`now`. If you need a fake clock, there's already a seam — don't add a global mock.

Before pushing:
```sh
npm run core:typecheck && npm run core:test
npm run desktop:lint && npm run desktop:typecheck
npm run web:lint && npm run web:typecheck && npm run web:build
cd apps/desktop/src-tauri && cargo test -- --skip plays_hires_tone_through_default_device
cd apps/android && ./gradlew.bat testDebugUnitTest
```
That is exactly what [ci.yml](../.github/workflows/ci.yml) runs. Remember `cargo test` needs the
frontend dist built first.

---

## Traps

| Trap | Why |
|---|---|
| Forgetting the `invoke_handler` registration | Compiles fine, fails at runtime |
| Adding a Room entity without a migration | Runtime crash; no CI safety net |
| Changing a rule/stats semantic in one language | Silent cross-device divergence — the fixture is the only guard |
| Treating Realtime as the source of truth | It's a "pull sooner" hint; cursors converge |
| Enqueuing an op for an identity-less track | Dropped (`enqueue.dropped`); the DB would reject it anyway |
| Assuming Android durations are seconds | Room stores `durationMs` |
| `NEXT_PUBLIC_`-prefixing a web secret | Inlined into the browser bundle |
| Hard-deleting synced rows | Invisible to `updated_at` cursors |
| Adding a feature to one client and calling it done | See [FEATURE_PARITY.md](FEATURE_PARITY.md) — this is how the current gaps happened |
