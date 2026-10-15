# Architecture Decisions

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; ADR-019 to ADR-021 added 2026-10-13 for
> the vault, which supersedes ADR-002, 003, 016 and 017. Superseded entries are kept as the record
> of why the system was first built that way.
> Rationale here is **inferred from code comments, schema comments, [PLAN.md](../PLAN.md),
> [docs/architecture.md](../docs/architecture.md) and commit history**. This codebase is unusually
> well-commented about *why*, so most entries quote a primary source.
> Where reasoning is my inference rather than the author's stated intent, it is marked
> **🔍 Speculative** and separated from the evidence.

## Index

| # | Decision | Confidence |
|---|---|---|
| [001](#adr-001-reuse-three-mature-apps-rather-than-rewrite) | Reuse three mature apps rather than rewrite | Documented |
| [002](#adr-002-supabase-stores-metadata-only-drive-stores-audio-only) | Supabase stores metadata only; Drive stores audio only | ⛔ Superseded by 019 |
| [003](#adr-003-dual-track-identity-drive-fileid--blake3-content-hash) | Dual track identity: Drive fileId + BLAKE3 hash | ⛔ Superseded by 020 |
| [004](#adr-004-offline-first-with-a-persisted-outbox) | Offline-first with a persisted outbox | Documented |
| [005](#adr-005-two-timestamps-updated_at-for-cursors-edited_at-for-lww) | Two timestamps: `updated_at` vs `edited_at` | Documented |
| [006](#adr-006-soft-state-instead-of-deletes) | Soft state instead of deletes | Documented |
| [007](#adr-007-fractional-indexes-for-playlist-ordering) | Fractional indexes for ordering | Documented |
| [008](#adr-008-append-only-play-events-no-play-count-column) | Append-only play events, no play-count column | Documented |
| [009](#adr-009-smart-playlists-as-a-json-rule-ast) | Smart playlists as a JSON rule AST | Documented |
| [010](#adr-010-shared-logic-two-implementations-one-fixture-set) | Shared logic: two implementations, one fixture set | Documented |
| [011](#adr-011-replaceable-components-aspirational-in-two-places) | "Replaceable components" — aspirational in two places | ⚠️ Output: contradicted by code · storage: resolved by 019 |
| [012](#adr-012-two-tier-cache-auto--pinned) | Two-tier cache (auto + pinned) | Documented |
| [013](#adr-013-sqlite-room-indexeddb--three-local-stores-not-one) | Three local stores, not one | Partly 🔍 |
| [014](#adr-014-ports-and-adapters-for-the-sync-engine-only) | Ports & adapters — for the sync engine only | Documented |
| [015](#adr-015-vendored-libwavpack-instead-of-a-system-dependency) | Vendored libwavpack | Documented |
| [016](#adr-016-local-mode-as-a-first-class-state) | Local mode as a first-class state | ⛔ Superseded by 021 |
| [017](#adr-017-tokens-in-os-credential-stores-never-in-the-app-db) | Tokens in OS credential stores | ⛔ Superseded by 019 (no Google tokens remain) |
| [018](#adr-018-rls-as-the-only-authorization-layer) | RLS as the authorization layer (+ the vault function) | Partly 🔍 |
| [019](#adr-019-a-private-r2-vault-behind-a-signing-edge-function) | A private R2 vault behind a signing Edge Function | Documented |
| [020](#adr-020-content-hash-identity-and-details-edited-online) | Content-hash identity; details edited online | Documented |
| [021](#adr-021-account-required-and-a-fresh-start) | Account required, and a fresh start | Documented |

---

## ADR-001: Reuse three mature apps rather than rewrite

**Decision** — Build the cross-platform ecosystem on top of three existing local-only players
instead of starting fresh.

**Rationale** (documented, [PLAN.md:15-21](../PLAN.md)):
> "The three apps are mature, feature-complete **local** players whose stacks already match the
> target stack almost exactly … Rebuilding the Rust audio engine or the Android playback service
> from scratch would throw away the hardest, highest-quality work."

The plan budgeted ~85% reuse for desktop and Android, ~50% for web ("rebuild the shell": Vite SPA →
Next.js App Router), and enumerated eight things that "exist nowhere" and had to be built new —
Supabase, Drive, cross-device identity, the sync engine, the cache manager, the Next.js site,
Statistics 2.0, and metadata upgrades ([PLAN.md:33-45](../PLAN.md)).

**Consequences** — This single decision explains most of the project's shape. The three playback
engines are independent because they were *already* independent and excellent; only the *new* layers
(sync, rules, stats) are shared. It also explains the asymmetries in
[FEATURE_PARITY.md](FEATURE_PARITY.md): each app arrived with its own pre-existing feature set.

---

## ADR-002: Supabase stores metadata only; Drive stores audio only

> ⛔ **Superseded (2026-10) by [ADR-019](#adr-019-a-private-r2-vault-behind-a-signing-edge-function).**
> Audio now lives in a private R2 vault and the track details are owned by Supabase and edited
> online; Drive, `core/supabase/tracks.ts` and the metadata-publish step are gone.

**Decision** — A hard split: audio bytes never enter the database; metadata never lives in Drive.

**Rationale** (documented, [0001_init.sql:1-3](../supabase/migrations/0001_init.sql)):
> "Supabase stores METADATA AND USER STATE ONLY. Audio bytes live in Google Drive (and local
> folders); they never touch this database."

Reinforced at [docs/architecture.md:28-30](../docs/architecture.md): "Google Drive stores audio only
— metadata lives in Supabase after first extraction."

**Consequences** — Supabase stays on a free/cheap tier regardless of library size; Drive supplies
the storage the user already pays for. The cost was the metadata-publish dance (described in the
former Drive report): one device downloads, extracts tags, and upserts canonical rows so others get
metadata without downloading.

---

## ADR-003: Dual track identity (Drive fileId + BLAKE3 content hash)

> ⛔ **Superseded (2026-10) by [ADR-020](#adr-020-content-hash-identity-and-details-edited-online).**
> The Drive half of the identity was dropped in migration 0005; the BLAKE3 half — and the reasoning
> below about why a cross-device identity is needed at all — carries on.

**Decision** — Drive tracks key on the Drive `fileId`; local-only tracks on a BLAKE3 content hash;
the canonical row carries both.

**Rationale** (documented — [PLAN.md:88-98](../PLAN.md) calls it "critical design decision"):
> "Drive tracks: primary key = Google Drive `fileId` (stable, survives renames/moves). Local-only
> tracks: key = content hash (BLAKE3 of audio stream). … The same song in Drive **and** a local
> folder resolves to one track (hash match) so ratings, favorites, and stats never split."

The problem it solves is stated bluntly at [PLAN.md:41](../PLAN.md): "today desktop uses absolute
file path as track ID — **useless across devices**".

**Enforcement** — the database refuses identity-less rows:
`constraint tracks_identity check (drive_file_id is not null or content_hash is not null)`
([0001_init.sql:113](../supabase/migrations/0001_init.sql)), mirrored client-side by
`trackRefHasIdentity` ([core/sync/types.ts:25-27](../packages/core/src/sync/types.ts)) and pinned by
the test "drops ops whose track ref has no durable identity"
([syncEngine.test.ts:754](../packages/core/tests/syncEngine.test.ts)).

**Consequences** — Hashing must be incremental and off-thread (`spawn_hash_missing`,
[lib.rs:72-74](../apps/desktop/src-tauri/src/lib.rs)). `trackRefKey` needs a **priority order**
(`drive:` > `hash:` > `remote:`) "so an op enqueued before the remote row existed still matches one
after" ([core/sync/types.ts:29-38](../packages/core/src/sync/types.ts)) — and `trackRefKeys` returns
*every* key because "an op that only knew a content hash still matches a remote row that also
carries a Drive id" ([:40-51](../packages/core/src/sync/types.ts)). Desktop kept the file path as
its *local* id ([docs/architecture.md:71-76](../docs/architecture.md)) — the cross-device identity is
additive, which is why ADR-001's reuse worked.

---

## ADR-004: Offline-first with a persisted outbox

**Decision** — Every client works fully offline; the cloud is a sync target, not a dependency.

**Rationale** (documented, [docs/architecture.md:24-25](../docs/architecture.md)):
> "Every client works fully offline; cloud state is a sync target, not a dependency. Pending changes
> queue in a persisted outbox."

The invariant is named in the code: the outbox "survives crashes — the 'no data loss' invariant"
([core/sync/storage.ts:3-4](../packages/core/src/sync/storage.ts)), restated per platform
([db/mod.rs:146-147](../apps/desktop/src-tauri/src/db/mod.rs);
[syncStorage.ts:36-38](../apps/web/src/lib/syncStorage.ts): "queued mutations survive tab closes and
reloads").

**Consequences** — Every mutation is an op with a client UUID, replayable idempotently. Three
storage implementations of the same three stores. Realtime becomes a mere hint (ADR-005).

---

## ADR-005: Two timestamps — `updated_at` for cursors, `edited_at` for LWW

**Decision** — Separate the server's clock from the client's.

**Rationale** (documented, [0003_sync.sql:1-6](../supabase/migrations/0003_sync.sql)):
> "updated_at (server trigger) → pull cursors; edited_at (client-supplied) → last-writer-wins
> conflict resolution"

`play_events` needed the same treatment for the opposite reason
([0003_sync.sql:69-72](../supabase/migrations/0003_sync.sql)): "played_at is a client clock and can
be arbitrarily old when a device flushes an offline backlog; cursor pulls need server receive time"
— hence `created_at`.

**🔍 Speculative** — one clock cannot do both jobs: cursors need monotonicity in *server* time
(or an offline backlog would be skipped), while conflict resolution needs *intent* time (or the
device that reconnects last would always win). The `play_events.created_at` addition reads like it
was discovered in practice — it lands in migration 0003, not 0001.

**Consequences** — Correctness now depends on client clock sanity for LWW. Nothing in the code
detects or corrects skew ([TROUBLESHOOTING.md](TROUBLESHOOTING.md#a-change-reverted)).

---

## ADR-006: Soft state instead of deletes

**Decision** — Un-favoriting sets `favorite = false`; clearing a rating sets `rating = 0`; playlists
and items get `deleted_at`.

**Rationale** (documented, [0003_sync.sql:9-11](../supabase/migrations/0003_sync.sql)):
> "Un-favoriting used to delete the row; **deletions are invisible to updated_at cursors**, so
> favorites become soft state: favorite = false."

This forced the rating check constraint to widen from 1–5 to **0–5**
([0003_sync.sql:25-26](../supabase/migrations/0003_sync.sql)) — visible archaeology: 0001 wrote
`check (rating between 1 and 5)` and 0003 dropped and replaced it.

**Consequences** — "0 = unrated" is now a load-bearing convention echoed in every schema and in the
golden fixture's contract ("rating 0/absent = unrated"). Rows accumulate rather than disappear; no
compaction exists.

---

## ADR-007: Fractional indexes for playlist ordering

**Decision** — `position` is a **string** fractional index, not an integer.

**Rationale** (documented, [0001_init.sql:132-135](../supabase/migrations/0001_init.sql)):
> "position is a fractional index string so concurrent reorders merge without rewriting sibling rows."

**Consequences** — Concurrent reorder + add merges without conflict, pinned by "concurrent reorder +
add merge: both intents survive" ([syncEngine.test.ts:595](../packages/core/tests/syncEngine.test.ts)).
The cost is a second implementation ([Fractional.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/Fractional.kt))
and a translation layer: local stores keep an integer `position`
([db/mod.rs:154-159](../apps/desktop/src-tauri/src/db/mod.rs)) and convert at the sync boundary.
**🔍 Speculative**: keeping integers locally probably preserved the pre-existing local schema
(ADR-001) — a fractional index is only needed where concurrency exists, and a single device has none.

---

## ADR-008: Append-only play events, no play-count column

**Decision** — All statistics derive from an event stream. No aggregate columns.

**Rationale** (documented, [0001_init.sql:208-212](../supabase/migrations/0001_init.sql)):
> "Append-only. Statistics are derived from these rows; there is no separate play_count column
> anywhere. id is CLIENT-GENERATED so offline replays are idempotent."

Restated at [docs/architecture.md:90-97](../docs/architecture.md). Append-only removes conflicts *by
construction* — "no conflicts by construction" ([docs/architecture.md:80](../docs/architecture.md)).

**Enforcement is at the database**: `play_events` has select and insert policies and **no
update/delete policies** ([0001_init.sql:225-229](../supabase/migrations/0001_init.sql)). This is a
capability, not a convention — even a compromised client cannot rewrite history.

**Consequences** — Rich derived stats (heatmaps, streaks, recap) with no migration cost. The
event id is shared between the local log and the sync op so merged sources dedupe
([core/stats.ts:103](../packages/core/src/stats.ts)). ⚠️ Android's legacy `play_history` aggregate
table survives this decision ([DATABASE.md §3.2](DATABASE.md#32-entities--entitieskt)) — a
pre-Phase-7 remnant, and the clearest inconsistency with this ADR.

**Sub-decision: the log outlives sign-out.** All three clients repeat: "Device-owned history:
deliberately NOT wiped on sign-out, unlike sync_*"
([db/mod.rs:190-193](../apps/desktop/src-tauri/src/db/mod.rs)), which is why web puts it in a
*separate* database (`mv-stats`, not `mv-sync`) — "listening history is device-owned and
deliberately survives sign-out, unlike sync state"
([playEventLog.ts:5-9](../apps/web/src/lib/playEventLog.ts)).

---

## ADR-009: Smart playlists as a JSON rule AST

**Decision** — Rules are a plain-JSON AST of nested AND/OR groups, stored verbatim.

**Rationale** (documented, [core/smartRules.ts:1-9](../packages/core/src/smartRules.ts)):
> "The AST is plain JSON so it can be stored in SQLite/Room/Supabase and evaluated by the Kotlin
> port (`SmartRules.kt`) with identical results."

**Consequences** — One column per store (`smart_rules` TEXT / `smartRules` / `smart_rules jsonb`) and
no schema change to add operators. Evaluation input is deliberately platform-neutral
(`RuleTrackInput`: "duration in seconds, timestamps in epoch ms, rating 0 = unrated",
[docs/architecture.md:56-59](../docs/architecture.md)) — necessary because Room stores
`durationMs` while core uses seconds. Version-stamped (`version: 1`) for future migration.

---

## ADR-010: Shared logic — two implementations, one fixture set

**Decision** — Port TypeScript logic to Kotlin by hand; pin both with shared golden fixtures.

**Rationale** (documented, [docs/architecture.md:45-47](../docs/architecture.md)):
> "Android cannot consume TypeScript; shared logic is ported 1:1 to Kotlin … and both
> implementations are validated against the same golden-test fixtures."

The contract is enforced socially, in three places that all say the same thing —
[core/smartRules.ts:6-8](../packages/core/src/smartRules.ts) ("if you change semantics here, update
the fixtures and the Kotlin port together"), [docs/architecture.md:57-58](../docs/architecture.md)
("change semantics in lockstep or not at all"), and the fixture's own `$comment` ("**Do not change
semantics in one engine without updating the other AND these fixtures.**").

**Alternatives not taken** — Kotlin/JS, a WASM core, or a JS runtime on Android would have given one
implementation. **🔍 Speculative**: each would have compromised ADR-001's reuse (Android is idiomatic
Compose/Hilt/Room; embedding a JS runtime would be a foreign body) and would burden the *playback*
path, which is the most performance-sensitive code. Hand-porting ~800 lines of pure functions and
pinning them with fixtures is a smaller, more reversible bet.

**Consequences** — Every semantic change is a three-file change. The fixtures are load-bearing
infrastructure, not tests ([TESTING.md §1](TESTING.md#1-the-strategy-golden-fixtures-pin-two-implementations)).
The sync engines are *not* fixture-linked — they have parallel hand-written suites (22 TS / 18
Kotlin cases), which is a weaker guarantee for the most complex shared logic in the project.

---

## ADR-011: "Replaceable components" — aspirational in two places

**Decision as documented** ([docs/architecture.md:30-32](../docs/architecture.md)):
> "Replaceable components. UI ↔ business logic ↔ storage ↔ playback ↔ networking are separated per
> client; **the desktop audio output sits behind a trait** so WASAPI-Exclusive/ASIO can slot in later."

[PLAN.md:153-160](../PLAN.md) repeats it — "The trait boundary in `audio/output.rs` is where
WASAPI-Exclusive/ASIO backends slot in later" — and adds "APE/WavPack via additional decoder crates
behind the same **decoder trait**".

### ⚠️ Both claims are contradicted by the code

Verified during this audit:
- **No trait is defined anywhere in `apps/desktop/src-tauri/src/audio/`.** The only `trait` tokens in
  the directory are cpal's own imports (`use cpal::traits::{DeviceTrait, HostTrait, StreamTrait}`,
  [audio/output.rs:4](../apps/desktop/src-tauri/src/audio/output.rs)).
- `Output` is a **concrete struct** with `open`/`request_flush` wrapping cpal directly
  ([audio/output.rs:22-124](../apps/desktop/src-tauri/src/audio/output.rs)).
- `DecodedStream` is likewise a **concrete struct**
  ([audio/decoder.rs:21-83](../apps/desktop/src-tauri/src/audio/decoder.rs)); APE and WavPack were
  added inside it and via [audio/wv.rs](../apps/desktop/src-tauri/src/audio/wv.rs), not behind an
  abstraction.

The separation that *does* exist is real but different: **module boundaries** (`audio/`, `db/`,
`vault/`, `scan/`, `commands/`) and a genuine ports-and-adapters design in the sync engine (ADR-014).
At the audit date there was also **no storage-provider abstraction** despite
[PLAN.md](../PLAN.md) listing "Additional storage providers behind the Drive client interface".
**Update 2026-10**: that half is resolved — not by an interface but by
[ADR-019](#adr-019-a-private-r2-vault-behind-a-signing-edge-function): storage sits behind one
function speaking the S3 API, so another S3-compatible store is a configuration change.

**Consequences** — The v1 outcome is unaffected: swapping decoders worked fine without a trait. But
the output-backend roadmap item is **larger than the documents imply** — it starts with "extract an
abstraction", not "add an implementation". This is documentation aspiration
recorded as fact; the docs should be corrected rather than the code
([ROADMAP.md](ROADMAP.md#not-started)).

---

## ADR-012: Two-tier cache (auto + pinned)

**Decision** — Tier 1 auto-cache (LRU-evicted under a cap); tier 2 pinned downloads (never
auto-evicted).

**Rationale** (documented, [docs/architecture.md:26-27](../docs/architecture.md)):
> "Audio never streams twice. Pressing Play on a non-local track downloads it into the cache; every
> later play uses the local copy."

Tier definitions at [vault/cache.rs:1-5](../apps/desktop/src-tauri/src/vault/cache.rs); resolution
order pinned → cache → download-then-play from a signed URL
([docs/architecture.md](../docs/architecture.md)).

**Consequences** — Two directories, one `pinned` flag, one LRU index (`idx_cache_lru (pinned,
last_access)`); `promote_to_pinned` moves tiers with **no re-download**
([vault/cache.rs](../apps/desktop/src-tauri/src/vault/cache.rs)). Default cap 10 GiB. **🔍
Speculative**: the two tiers exist because "recently played" and "deliberately kept" are different
user intents that a single LRU cannot express — evicting an album someone downloaded for a flight
would be a bug, not a cache miss. Android reaches the same model differently (Media3 `SimpleCache`
for tier 1), which is ADR-001 showing through.

---

## ADR-013: SQLite, Room, IndexedDB — three local stores, not one

**Decision** — Each client keeps its native persistence rather than converging on one engine.

**Evidence** — ADR-001's reuse mandate; each store pre-dates the cross-platform work. The *sync*
tables (`sync_outbox`/`sync_cursors`/`sync_shadow`) were then added identically to all three, with
Room's comment stating the intent explicitly
([Entities.kt:105-108](../apps/android/app/src/main/java/com/musicvault/data/db/Entities.kt)):
> "Mirrors desktop's sync_outbox / sync_cursors / sync_shadow SQLite tables"

**Consequences** — Three migration systems ([DATABASE.md](DATABASE.md)), and real divergences:
Room stores `durationMs` where core uses seconds; desktop's track id is a file path where Android's
is opaque; Android has `play_history` and `queue_items` that nobody else has. **🔍 Speculative**: the
`SyncStorage` port is what makes this affordable — the engine only sees three key/value stores, so
the underlying engine is genuinely irrelevant to it. The divergence that *isn't* absorbed by a port
(units, ids) is precisely where the bugs would live.

---

## ADR-014: Ports and adapters — for the sync engine only

**Decision** — `SyncEngine` depends on two injected interfaces (`SyncTransport`, `SyncStorage`) plus
injectable `now`/`uuid`.

**Rationale** (documented, [core/sync/engine.ts:62-68](../packages/core/src/sync/engine.ts)):
> "One instance per signed-in session. All server I/O goes through the transport, all persistence
> through the storage — **both injectable, so the whole conflict surface is testable without a
> network**."

Clock/uuid injection is labelled "Clock/uuid injection points for deterministic tests"
([:32-33](../packages/core/src/sync/engine.ts)); `autoSync: false` exists so "tests drive syncNow"
([:35-36](../packages/core/src/sync/engine.ts)).

**Consequences** — The 22-case conflict suite ([TESTING.md §2](TESTING.md#the-sync-engine-suite-765-lines-is-the-crown-jewel))
runs with no network and no database, and `MemorySyncStorage` ships in the library itself. Note the
scope: this is the **only** place in the codebase with this discipline — testability drove the design
exactly where correctness was hardest, and nowhere else (ADR-011).

---

## ADR-015: Vendored libwavpack instead of a system dependency

**Decision** — Vendor libwavpack C sources; compile them with the `cc` crate from `build.rs`;
hand-write minimal FFI.

**Rationale** (documented, [docs/architecture.md:125-127](../docs/architecture.md)):
> "`.wv` via vendored libwavpack C sources (`src-tauri/vendor/wavpack`, BSD-3) compiled by build.rs
> with hand-written minimal FFI — **no CMake/bindgen needed**."

`.ape` took the easier path: the pure-Rust `ape-decoder` crate.

**Consequences** — `cargo build` works with only the MSVC toolchain — no CMake, no bindgen, no
LLVM ([BUILD_AND_RUN.md](BUILD_AND_RUN.md#1-prerequisites)). The cost is ~25 vendored C files to
carry and patch, and hand-written FFI. `COPYING` is included, honoring BSD-3.
**🔍 Speculative**: for a personally-distributed Windows app, contributor-onboarding friction and
CI complexity likely outweighed the maintenance of a small vendored decoder.

---

## ADR-016: Local mode as a first-class state

> ⛔ **Superseded (2026-10) by [ADR-021](#adr-021-account-required-and-a-fresh-start).** With the
> library in the vault there is nothing for an unconfigured client to play; local mode was removed.

**Decision** — Missing cloud credentials is a supported *mode*, not an error.

**Rationale** (documented, [core/supabase/client.ts:10-12](../packages/core/src/supabase/client.ts)):
> "Returns the config when both env values are present, else null — clients treat null as 'local
> mode': **the app works fully, cloud features are hidden**."

Android agrees ("Empty values = local mode",
[build.gradle.kts:12-14](../apps/android/app/build.gradle.kts)); release CI leans on it ("Without
them the installer still works in local mode", [release.yml](../.github/workflows/release.yml)).
Drive is separately optional (`configured` in `DriveStatus`).

**Consequences** — Anyone can build and run without provisioning anything, which is why
[BUILD_AND_RUN.md](BUILD_AND_RUN.md) can start with `npm install`. It also follows naturally from
ADR-001: these *were* local apps, and local mode is simply that app still existing inside this one.
⚠️ It does not hold on web — no local import means local mode there is an empty app; and an
unconfigured web deployment silently loses route protection
([proxy.ts:22-25](../apps/web/src/proxy.ts)).

---

## ADR-017: Tokens in OS credential stores, never in the app DB

> ⛔ **Superseded (2026-10).** The Google OAuth tokens this protected no longer exist: the vault
> needs only the Supabase session, which each client's Supabase SDK stores. The R2 keys are
> Supabase secrets ([ADR-019](#adr-019-a-private-r2-vault-behind-a-signing-edge-function)). The
> files cited below were removed.

**Decision** — Refresh tokens live in platform secret storage; access tokens live in memory only.

**Rationale** (documented, `drive/auth.rs:1-5`, removed with Drive in M6):
> "The refresh token is the only long-lived secret; it lives in the OS credential store (Windows
> Credential Manager via `keyring`). Access tokens stay in memory and are refreshed on demand."

Per platform: desktop `keyring`; Android `androidx.security.crypto`; web an AES-encrypted cookie
via `DRIVE_TOKEN_SECRET` (`lib/server/tokenCrypto.ts`, removed with Drive in M6).

**Consequences** — `library.db` contains no secrets and can be copied or backed up freely. The web
variant is the weakest link and the reason `DRIVE_TOKEN_SECRET` is the deployment's most sensitive
value. Related: the
*client secret* asymmetry is documented rather than assumed — non-confidential for Desktop-type
clients (`drive/mod.rs:12-14`, removed with Drive in M6), genuinely confidential
for the web client, which is the entire reason `/api/drive/*` exists.

---

## ADR-018: RLS as the authorization layer

**Decision** — Every table is RLS-protected on `user_id = auth.uid()`; clients hold only the anon key
and never filter by user for security.

**Evidence** — [PLAN.md:99](../PLAN.md) states it as a schema-wide rule ("all tables RLS:
`user_id = auth.uid()`"); every policy in [0001_init.sql](../supabase/migrations/0001_init.sql)
follows it; [rls_smoke.sql](../supabase/tests/rls_smoke.sql) verifies it. Clients never hold a
`service_role` key. **Since the vault** there is a second, narrow layer: the `vault` Edge Function
uses the service role to set the columns the `tracks_protect_vault_columns` trigger keeps from
clients, and it signs only keys a live row of the caller references
([ADR-019](#adr-019-a-private-r2-vault-behind-a-signing-edge-function)).

**Consequences** — The anon key ships publicly in every bundle, which is safe *only because* this
ADR holds. `play_events` extends it into a capability boundary (ADR-008). **🔍 Speculative**: a
single-user-per-account product has no authorization logic worth writing in application code — the
policies *are* the model, and pushing it into the database means no client can forget it.
⚠️ The gap: **CI never verifies RLS** ([TESTING.md §6](TESTING.md#6-supabase-sql-and-the-vault--manual)),
so the project's main authorization mechanism is checked by a script someone must remember to run.

---

## ADR-019: A private R2 vault behind a signing Edge Function

**Decision** (2026-10, [docs/drive-to-r2-migration.md](../docs/drive-to-r2-migration.md)) — Audio
and covers live in one private Cloudflare R2 bucket under `users/<uid>/…`, named by content hash.
No client holds R2 keys: the `vault` Edge Function signs short-lived GET (1 h) and PUT (15 min) URLs,
confirms uploads (`commit`) and deletes objects. Every descriptive detail lives in the Supabase row.

**Rationale** (documented in the migration plan) — Drive was a read-only *source*: the library
depended on folder conventions, three OAuth clients and per-platform token storage, and metadata had
to be scraped from files and published by whichever device downloaded first. The owner wanted to
upload by hand from any app and edit details online. A bucket with signed URLs gives every client
the same simple byte path; R2 has no egress fees; content-hash names make objects immutable, so
caches never go stale and identical covers are stored once.

**Consequences** — One server component (the function) and four secrets. Uploads, edits and
deletes exist on all three clients for the first time ([FEATURE_PARITY.md](FEATURE_PARITY.md)). The
web app lost its server routes and secrets. Storage is now swappable for any S3-compatible store.
The cost: the vault is a paid service past 10 GB, and the first play of a track needs a network.

---

## ADR-020: Content-hash identity; details edited online

**Decision** — A track *is* the BLAKE3 hash of its audio, unique per user
(`check (deleted_at is not null or content_hash is not null)`,
[0005_drop_drive.sql](../supabase/migrations/0005_drop_drive.sql)). Its details are edited online
as `track.edit` ops applied with **field-level** last-writer-wins (`field_edited_at`,
`apply_track_edit`); technical facts are read-only. Rows are tombstoned, never hard-deleted.

**Rationale** — One identity removes the priority rules ADR-003 needed; uploading a file that is
already known attaches to its row, so history never splits. Field-level LWW lets two devices edit
different fields of one track without one edit erasing the other. The rule exists in SQL,
TypeScript and Kotlin and is pinned by one fixture,
[track-edit.golden.json](../docs/fixtures/track-edit.golden.json) — ADR-010's pattern extended to
the database.

**Consequences** — Re-encoding a file makes it a different track (replacing audio while keeping
history is a known gap). Tombstones let cursor pulls see deletions and let a re-upload revive a
deleted track; edits for a revived row are sent after `commit`.

---

## ADR-021: Account required, and a fresh start

**Decision** — Every client requires a signed-in account (no local mode), and the switch to the
vault reset every library: the server was wiped, desktop SQLite v9, Room v7 and the web's
`freshStart` cleared local libraries, playlists, history and caches, keeping device settings.

**Rationale** — The owner chose to rebuild the library by uploading rather than import Drive
(decision 8 in the migration plan; step M5 dropped). With the library in the account, an
unconfigured client has nothing to show, so local mode only added code paths.

**Consequences** — Simpler clients (no local scanning, watching, duplicates view or Drive code), at
the price of losing the old local play history and playlists once. Builds without Supabase values
say so instead of running.

---

## Cross-cutting observation

The decisions cohere around one theme: **push invariants into the layer that cannot forget them.**
Identity into a check constraint; append-only into RLS policies; conflict-freedom into fractional
indexes and event streams; determinism into injected clocks and fixed-offset zones.

The exceptions are where the project is weakest, and they are consistent: the output
"abstraction" that exists only in prose (ADR-011), the Kotlin ports held together by convention rather than a
compiler (ADR-010), and RLS — the load-bearing security decision — verified by a manual script
(ADR-018).
