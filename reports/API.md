# API Reference

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; updated 2026-10-13 for the vault; cache and
> download commands updated 2026-10-15.
> Every public interface in the repository: Tauri/Rust commands and events, the `@musicvault/core`
> TypeScript API, the web app's server surface, Android repositories, Supabase interactions and the
> `vault` Edge Function. Schema details live in [DATABASE.md](DATABASE.md); vault specifics in
> [VAULT.md](VAULT.md).

---

# 1. Tauri commands (desktop)

**49 commands**, registered in one `invoke_handler` at
[lib.rs:121-171](../apps/desktop/src-tauri/src/lib.rs) and implemented under
[src-tauri/src/commands/](../apps/desktop/src-tauri/src/commands). The frontend calls them through
the typed wrapper [src/lib/ipc.ts](../apps/desktop/src/lib/ipc.ts).

**Conventions**
- Rust `snake_case` parameters arrive from JS as `camelCase` (Tauri converts); response structs
  are `#[serde(rename_all = "camelCase")]` (e.g. [commands/vault.rs](../apps/desktop/src-tauri/src/commands/vault.rs)).
- Fallible commands return `Result<T, String>` — errors reach JS as a rejected promise carrying
  the string.
- `State<'_, Db>` locks a shared `Arc<Mutex<Connection>>`; `State<'_, EngineHandle>` posts a
  message to the audio thread ([DATABASE.md §2](DATABASE.md#2-desktop--sqlite-rusqlite)).

## 1.1 Player — [commands/player.rs](../apps/desktop/src-tauri/src/commands/player.rs)

All player commands are **fire-and-forget** message sends into the audio engine (`engine.send(Cmd::…)`);
only `player_set_eq` can fail.

| Command | Parameters | Returns |
|---|---|---|
| `player_load` | `path: String, start_at: f64, autoplay: bool, rg_db: Option<f64>` | — |
| `player_play` / `player_pause` / `player_stop` | — | — |
| `player_seek` | `position: f64` (seconds) | — |
| `player_set_volume` | `volume: f32` | — |
| `player_set_eq` | `bands: Vec<f32>` | `Result<(), String>` — **must be exactly 10 bands** ([:42-48](../apps/desktop/src-tauri/src/commands/player.rs)) |
| `player_set_crossfade` | `seconds: f32` | — |
| `player_set_gapless` | `enabled: bool` | — |
| `player_preload_next` | `path: Option<String>, rg_db: Option<f64>` | — |
| `player_set_rg` | `rg_db: Option<f64>` | — |
| `player_set_visualizer` | `enabled: bool` | — |

`rg_db` threads the resolved ReplayGain value per stream, which is what keeps gain correct across
gapless splices — see [FEATURES.md](FEATURES.md#replaygain).

## 1.2 Library

There are no library commands: the desktop has no local track table since SQLite v9. The library
is projected in TypeScript from the synced `tracks` rows (`projectVault`,
[lib/vaultMerge.ts](../apps/desktop/src/lib/vaultMerge.ts)); favorites, ratings and edits travel
as sync ops (§2.4). Uploads, downloads and the cache go through the vault commands (§1.7).

## 1.3 Playlists — [commands/playlists.rs](../apps/desktop/src-tauri/src/commands/playlists.rs)

| Command | Parameters | Returns |
|---|---|---|
| `playlists_get_all` | — | `Result<Vec<PlaylistRow>, String>` |
| `playlists_create` | `name`, smart flags | `Result<…, String>` |
| `playlists_rename` | `id: String, name: String` | `Result<(), String>` |
| `playlists_delete` | `id: String` | `Result<(), String>` |
| `playlists_set_tracks` | `id: String, track_ids: Vec<String>` | `Result<(), String>` |
| `playlists_set_rules` | `id: String, smart_rules: String` | `Result<(), String>` — the rule AST as **JSON text**, stored verbatim |

`PlaylistRow` ([db/models.rs:43-51](../apps/desktop/src-tauri/src/db/models.rs)) hydrates
`track_ids: Vec<String>` alongside the row.

## 1.4 Settings — [commands/settings.rs](../apps/desktop/src-tauri/src/commands/settings.rs)

| Command | Parameters | Returns |
|---|---|---|
| `settings_get` | — | `Result<Option<String>, String>` |
| `settings_set` | `json: String` | `Result<(), String>` |

The entire `Settings` object round-trips as **one JSON string** — the Rust side does not model it.

## 1.5 Sync — [commands/sync.rs](../apps/desktop/src-tauri/src/commands/sync.rs)

These are the desktop's implementation of the shared `SyncStorage` port (§2.4); the engine itself
runs in TypeScript.

| Command | Parameters | Returns |
|---|---|---|
| `sync_outbox_all` | — | `Result<Vec<SyncOutboxRow>, String>` |
| `sync_outbox_put` | op fields | `Result<(), String>` |
| `sync_outbox_delete` | `ids: Vec<String>` | `Result<(), String>` |
| `sync_outbox_bump` | `ids: Vec<String>` | `Result<(), String>` (attempt counter) |
| `sync_cursor_get` | `name: String` | `Result<Option<String>, String>` |
| `sync_cursor_set` | `name: String, value: String` | `Result<(), String>` |
| `sync_shadow_get` | `entity: String, id: String` | `Result<Option<String>, String>` |
| `sync_shadow_put` | `entity, id, payload` | `Result<(), String>` |
| `sync_shadow_delete` | `entity: String, id: String` | `Result<(), String>` |
| `sync_shadow_all` | `entity: String` | `Result<Vec<SyncShadowRow>, String>` |
| `sync_clear_all` | — | `Result<(), String>` — sign-out wipe (**does not touch `play_events`**) |
| `sync_breadcrumb` | `event: String, detail: Option<String>` | — (diagnostics → the appdata log) |

## 1.6 History — [commands/history.rs](../apps/desktop/src-tauri/src/commands/history.rs)

| Command | Parameters | Returns |
|---|---|---|
| `play_event_add` | `id: String, track_id: String, played_at: i64, duration_played: f64, completed: bool` | `Result<(), String>` |
| `play_events_all` | — | `Result<Vec<PlayEventLocalRow>, String>` |

The module header states the contract: "Statistics on the frontend merge these rows with the
synced play_events shadow, deduping on the shared event id"
([commands/history.rs:6-7](../apps/desktop/src-tauri/src/commands/history.rs)).

## 1.7 Vault — [commands/vault.rs](../apps/desktop/src-tauri/src/commands/vault.rs)

The Rust half of uploads and downloads. Signed URLs come from the `vault` Edge Function through
the core client (§2.5); Rust only moves bytes and keeps the cache.

| Command | Parameters | Returns | Notes |
|---|---|---|---|
| `vault_prepare_files` | `paths: Vec<String>` | `Result<Vec<PrepareResult>, String>` | Files or folders (walked); per file: BLAKE3, tags, technical facts, embedded cover staged as JPEG + thumb, sibling `.lrc` ([vault/prepare.rs](../apps/desktop/src-tauri/src/vault/prepare.rs)) |
| `vault_prepare_cover` | `path: String` | `Result<PreparedCover, String>` | An image picked as a cover, squared and staged |
| `vault_put_file` | `url, path, upload_id, content_type` | `Result<(), String>` | Streams a file to a signed PUT URL, emitting `vault://upload-progress` |
| `vault_cached` | `content_hash: String` | `Result<Option<String>, String>` | The cached or pinned copy's path, if any |
| `vault_download` | `content_hash, ext, url, pin: bool` | `Result<String, String>` (local path) | Downloads into the auto-cache (`pin=false`) or pinned downloads, **verified against the hash** ([vault/transfer.rs](../apps/desktop/src-tauri/src/vault/transfer.rs)); a second caller waits for the in-flight download |
| `vault_fetch_art` | `url, file_name` | `Result<String, String>` | A cover into `artwork/` (no-op when present) |
| `vault_adopt_art` | `sha256, full_path, thumb_path` | `Result<String, String>` | Moves a just-uploaded cover from staging into `artwork/` |
| `vault_forget_deleted` | `content_hashes: Vec<String>` | `Result<usize, String>` | Drops cached/pinned copies of tracks deleted from the vault |
| `vault_downloads_list` | — | `Result<Vec<CacheEntryRow>, String>` | |
| `vault_download_remove` | `file_id: String` | `Result<(), String>` | Removes from disk **and** the index |
| `vault_download_cancel` | `file_ids: Vec<String>` | `Result<(), String>` | Stops in-flight downloads of these cache keys at the next chunk; keys with no download running are ignored ([vault/transfer.rs](../apps/desktop/src-tauri/src/vault/transfer.rs)). The stopped download fails with `cancelled` |
| `vault_cache_stats` | — | `Result<CacheStats, String>` | |
| `vault_cache_set_max` | `max_bytes: i64` | `Result<CacheStats, String>` | Clamps to 0..10 GiB (0 = off), persists the cap (`cache_max_bytes`) **and evicts down to it immediately**, sparing the two most recent entries |
| `vault_cache_clear` | — | `Result<CacheStats, String>` | Empties the auto tier except the two most recent entries; pinned downloads stay |

## 1.8 Shell & window — [commands/mod.rs](../apps/desktop/src-tauri/src/commands/mod.rs), [commands/window.rs](../apps/desktop/src-tauri/src/commands/window.rs)

| Command | Parameters | Returns | Notes |
|---|---|---|---|
| `smtc_update` | `title, artist, album, artwork_path: Option<String>, duration: f64` | `Result<(), String>` | Updates **both** the tray tooltip and SMTC in one call ([mod.rs:27-40](../apps/desktop/src-tauri/src/commands/mod.rs)) |
| `smtc_playback` | `playing: bool, position: f64` | `Result<(), String>` | Same dual update |
| `mini_toggle` | — | `Result<(), String>` | Opens a 400×132 frameless always-on-top `mini` window at the primary monitor's top-right and **hides main**; closing it restores main via the `Destroyed` handler ([window.rs:8-37](../apps/desktop/src-tauri/src/commands/window.rs)) |

## 1.9 Rust events (backend → frontend)

Emitted with Tauri's event system and consumed by hooks/stores:

| Event | Emitted by | Purpose |
|---|---|---|
| `vault://download-progress`, `vault://download-done`, `vault://download-error` | [vault/transfer.rs](../apps/desktop/src-tauri/src/vault/transfer.rs) | Download lifecycle |
| `vault://upload-progress` | [vault/transfer.rs](../apps/desktop/src-tauri/src/vault/transfer.rs) | Upload progress per `upload_id` |
| `player://state`, `player://position`, `player://ended`, `player://advanced`, `player://spectrum` | [audio/](../apps/desktop/src-tauri/src/audio) | Engine → UI |
| `smtc://control` | [smtc.rs](../apps/desktop/src-tauri/src/smtc.rs) / [tray.rs](../apps/desktop/src-tauri/src/tray.rs) | **Shared** transport-control channel for media keys, the tray menu and jump-list tasks ([docs/architecture.md:109-112](../docs/architecture.md)) |
| `mini://*` | [lib/miniBridge.ts](../apps/desktop/src/lib/miniBridge.ts) | Mini-player state snapshots + commands between the two webviews |

## 1.10 CLI arguments

`--media-control=<toggle\|next\|prev>` — used by Windows jump-list tasks, which relaunch the exe;
the `single-instance` plugin forwards the arg to the running instance and returns without stealing
focus ([lib.rs:18-30](../apps/desktop/src-tauri/src/lib.rs),
[jumplist.rs](../apps/desktop/src-tauri/src/jumplist.rs)). Any other second launch surfaces the
mini window if open, else main.

## 1.11 Capabilities

[capabilities/default.json](../apps/desktop/src-tauri/capabilities/default.json) grants
`core:default`, `dialog:default`, `notification:default` to the `main` and `mini` windows. The
asset protocol is enabled but **scoped to `$APPDATA/artwork/**`**
([tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json)) — artwork is the only thing the
webview may read from disk directly. `csp` is `null` (disabled).

---

# 2. `@musicvault/core` (shared TypeScript)

Import surface: everything is re-exported from
[src/index.ts](../packages/core/src/index.ts).

## 2.1 Types — [types.ts](../packages/core/src/types.ts)

`Track`, `Playlist`, `LyricLine`, `Settings`, `EqBand`, `RepeatMode`, `ReplayGainMode`,
`ThemeMode`, `AccentPreset`, `AccentColor`; constants `ACCENT_PRESETS`, `EQ_FREQS`, `EQ_PRESETS`.
Detailed in [FEATURES.md](FEATURES.md#settings).

## 2.2 Supabase

### Client — [supabase/client.ts](../packages/core/src/supabase/client.ts)
| Export | Signature | Notes |
|---|---|---|
| `MusicVaultClient` | `SupabaseClient<Database>` | Typed against the generated schema |
| `resolveSupabaseConfig` | `(url?, anonKey?) => SupabaseConfig \| null` | null = the build has no Supabase config; since the vault there is no local mode, so the apps show a "needs an account" notice instead |
| `createMusicVaultClient` | `(config) => MusicVaultClient` | `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false` |

### Auth — [supabase/auth.ts](../packages/core/src/supabase/auth.ts)
| Export | Signature |
|---|---|
| `signUp` | `(client, email, password, displayName?) => Promise<AuthResult>` |
| `signIn` | `(client, email, password) => Promise<AuthResult>` |
| `signOut` | `(client) => Promise<void>` |
| `getSession` | `(client) => Promise<Session \| null>` |
| `onAuthStateChange` | `(client, cb) => () => void` (returns unsubscribe) |

Email/password only. Every function throws on error rather than returning it.

### Devices — [supabase/devices.ts](../packages/core/src/supabase/devices.ts)
`registerDevice(client, userId, info: DeviceInfo, existingDeviceId?) => Promise<DeviceRow>`.
If `existingDeviceId` is supplied it updates `last_seen_at` + `name`; if that row is gone it
**falls through and re-registers** ([:19-30](../packages/core/src/supabase/devices.ts)). Callers
persist `id` locally.

Track rows are no longer read or written outside the sync engine: `core/supabase/tracks.ts` was
removed with Drive. New rows come from `uploadTrack` (§2.5); edits are `track.edit` ops.

## 2.3 Domain engines

| Module | Key exports |
|---|---|
| [smartRules.ts](../packages/core/src/smartRules.ts) | `SmartRules`, `RuleGroup`, `RuleCondition`, `RuleField` (17), `RuleOp` (21), `RuleTrackInput`, `emptySmartRules`, evaluator |
| [smartPlaylists.ts](../packages/core/src/smartPlaylists.ts) | `SMART_PLAYLISTS` (9 defs), `smartDef`, `computeSmartTracks`, `computeSmartGroups`, `HistoryData`, `SmartGroup` |
| [stats.ts](../packages/core/src/stats.ts) | `StatsEvent`, `StatsTrackMeta`, `StatsZone`, `fixedOffsetZone`, `systemZone`, `dedupeEvents`, `filterRange`, `rangeForPreset`, `STATS_RANGE_PRESETS`, `summarize`, `rankTracks`, `rankGroups`, `bucketize`, `hourHistogram`, `computeStreaks`, `computeRecap`, `recapYears`, `dayKeyOf`, `UNKNOWN_TRACK` |
| [albums.ts](../packages/core/src/albums.ts) | Album grouping |
| [lrc.ts](../packages/core/src/lrc.ts) | LRC parser |
| [format.ts](../packages/core/src/format.ts) | Duration/size formatting |
| [trackFields.ts](../packages/core/src/trackFields.ts) | `EDITABLE_TRACK_FIELDS`, `READ_ONLY_TRACK_FIELDS`, `TrackEditPatch`, `normalizeTrackPatch`, `checkTrackEdit`, `applyTrackEdit` (field-level LWW), `overlayTrackEdits`, `diffTrackFields`, `TrackEditError` |

Signatures for the stats functions are tabulated in [FEATURES.md](FEATURES.md#statistics).

## 2.4 Sync engine — [sync/](../packages/core/src/sync)

### `SyncEngine` — [sync/engine.ts](../packages/core/src/sync/engine.ts)

Constructor: `new SyncEngine(transport: SyncTransport, storage: SyncStorage, opts: SyncEngineOptions)`.
"One instance per signed-in session. All server I/O goes through the transport, all persistence
through the storage — both injectable, so the whole conflict surface is testable without a
network" ([:62-69](../packages/core/src/sync/engine.ts)).

| Method | Signature | Purpose |
|---|---|---|
| `init()` | `Promise<void>` | Loads the track shadow into the identity maps — **call once before use** |
| `start()` / `stop()` | `void` | Realtime subscription lifecycle |
| `enqueue(payload)` | `(SyncOpPayload) => Promise<void>` | Queue a mutation (kicks a cycle unless `autoSync: false`) |
| `syncNow(fullPull = false)` | `Promise<void>` | Run a cycle now |
| `notifyOnline()` | `void` | Connectivity regained |
| `getStatus()` | `SyncStatus` | `{ phase, pendingOps, lastSyncAt, lastError }` |
| `getBreadcrumbs()` | `SyncBreadcrumb[]` | Diagnostics |

`SyncEngineOptions` ([:28-41](../packages/core/src/sync/engine.ts)): `deviceId`, `now?`, `uuid?`
(clock/uuid injection for deterministic tests), `autoSync?`, `onChanges?`, `onStatus?`,
`onBreadcrumb?`. Realtime hints are debounced 800 ms (`REALTIME_DEBOUNCE_MS`, [:44](../packages/core/src/sync/engine.ts)).

### `SyncTransport` port — [sync/transport.ts:21-67](../packages/core/src/sync/transport.ts)

The complete server contract — 8 cursor pulls (paged, 1000 rows), identity lookup, track edits,
and per-entity read/upsert pairs:

```
pullTracks(since) · pullPlaylists(since) · pullPlaylistItems(since) · pullFavorites(since)
pullRatings(since) · pullSettings(since) · pullQueueState() · pullPlayEvents(since)
getTrackByHash(contentHash) · insertTrack(row) · applyTrackEdit(trackId, patch, editedAt)
getFavorite / upsertFavorite · getRating / upsertRating
getPlaylist / upsertPlaylist · getPlaylistItems / upsertPlaylistItem
getSetting / upsertSetting · upsertQueueState
insertPlayEvent          // append-only, idempotent on the client id
subscribe(onChange) => unsubscribe   // Realtime "pull sooner" hint
```

Note `pullQueueState()` takes no cursor (single row per user) and `insertPlayEvent` is the only
insert-without-read.

### `SyncStorage` port — [sync/storage.ts:16-33](../packages/core/src/sync/storage.ts)

```
outboxAll() · outboxPut(op) · outboxDelete(ids) · outboxBumpAttempts(ids)
cursorGet(name) · cursorSet(name, value)
shadowGet(entity, id) · shadowPut(entity, id, payload) · shadowDelete(entity, id) · shadowAll(entity)
clearAll()   // sign-out / account switch
```

Three stores with distinct jobs ([:11-15](../packages/core/src/sync/storage.ts)): **outbox**
(pending ops by `createdAt`), **cursors** (per-table pull cursors),
**shadow** (a local mirror of remote rows giving "offline knowledge of remote state: track
identity mapping, playlist item positions, LWW stamps").

**Implementations**: desktop → Tauri commands over SQLite
([lib/syncStorage.ts](../apps/desktop/src/lib/syncStorage.ts)); web → IndexedDB
`IdbSyncStorage` ([lib/syncStorage.ts](../apps/web/src/lib/syncStorage.ts)); Android →
[RoomSyncStorage.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/RoomSyncStorage.kt);
tests → `MemorySyncStorage` (exported from the same module,
[storage.ts:39-99](../packages/core/src/sync/storage.ts)).

### Types & helpers — [sync/types.ts](../packages/core/src/sync/types.ts)

| Export | Purpose |
|---|---|
| `SyncOp` | The persisted envelope `{ id, deviceId, createdAt, payload }` — `id` is the idempotency key |
| `SyncOpPayload` | The op-kind union, including `track.edit` ([FEATURES.md](FEATURES.md#sync)) |
| `TrackRef` / `trackRefHasIdentity` / `trackRefKey` / `trackRefKeys` | Track identity across ops |
| `opEntityKey(payload)` | Coalescing/conflict key |
| `opEditedAt(payload)` | The LWW timestamp (play events use `playedAt`) |
| `PlaylistSnapshot`, `TrackIdentity`, `FavoriteChange`, `RatingChange`, `PlaylistChange`, `PlaylistItemsChange`, `SettingChange`, `QueueChange` | Remote state as surfaced after a pull |
| `RemoteChanges` | The batch a pull applied, for projection into stores |
| `SyncStatus`, `SyncPhase`, `SyncBreadcrumb` | Status + diagnostics |

### Fractional indexes — [sync/fractional.ts](../packages/core/src/sync/fractional.ts)
Key generation for mergeable ordering; Kotlin port
[Fractional.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/Fractional.kt), both
covered by tests ([fractional.test.ts](../packages/core/tests/fractional.test.ts),
[FractionalTest.kt](../apps/android/app/src/test/java/com/musicvault/data/sync/FractionalTest.kt)).

## 2.5 Vault and uploads — [vault.ts](../packages/core/src/vault.ts), [upload.ts](../packages/core/src/upload.ts)

| Export | Purpose |
|---|---|
| `createSupabaseVaultApi(client)` → `VaultApi` | `signGet(keys)` (≤ `MAX_KEYS_PER_SIGN_GET` = 200), `signPutAudio(trackId, ext)`, `signPutArt(sha256, variant, size)`, `commit(trackId, ext)`, `remove(trackId)`, `resolveUploadTarget(contentHash)` |
| `SignedUrlCache` | Caches signed GET URLs until two minutes before expiry; batches lookups |
| `VaultError` / `VaultNetworkError` | A function error (`status`, `code`) vs. no connection |
| `thumbKeyOf(artworkKey)` | The thumbnail object beside a cover |
| `deletedVaultHashes(rows)` | Hashes of tombstoned rows, for dropping local copies |
| `AUDIO_EXTS`, `MAX_COVER_BYTES`, `COVER_MAX_PX`, `COVER_THUMB_PX` | Upload limits shared with the function |
| `UploadSource` → `draftFromSource` → `UploadDraft` | The review form's model; `applyBatchFields`, `validateDraft` |
| `newTrackRow(userId, draft, artworkKey)` | The insert for a new song |
| `uploadTrack(deps, draft)` → `UploadOutcome` | The whole flow: resolve → cover → row → audio → commit → edit (for a known row, after the commit). Platform specifics come in through `UploadDeps`. |

Flow and rules: [VAULT.md § Uploading](VAULT.md#uploading).

---

# 3. Web server surface

The web app has **no API routes**: audio and covers move between the browser and R2 through
signed URLs from the `vault` Edge Function (§6), so there is no server secret to protect. The
`app/api/drive/*` routes and `lib/server/*` were removed with Drive.

**Route protection** — [src/proxy.ts](../apps/web/src/proxy.ts) refreshes Supabase auth cookies on
every matched request and redirects signed-out visitors to `/login`; `/login`, `/auth` and `/help`
are public ([:5-8](../apps/web/src/proxy.ts)). When Supabase env vars are missing it passes through
so "pages render their own notice" ([:22-25](../apps/web/src/proxy.ts)).

---

# 4. Android repositories

Hilt `@Singleton`s injected into ViewModels. The reactive surface is Kotlin `Flow`; mutations are
`suspend fun`.

### `LibraryRepository` — [data/repo/LibraryRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/repo/LibraryRepository.kt)
`tracks: Flow<List<Track>>` — `VaultMerge` over the synced rows, queued edits, favorites, ratings
and covers; `hydrated: Flow<Boolean>` (true once the rows are read for the signed-in account);
`playlists: Flow<List<Playlist>>`.
`getTrack(id)`, `getTracksByIds(ids)`, `toggleFavorite(id)`, `setRating(id, rating)`,
`editTracks(…)` (enqueues `track.edit` ops), `deleteFromVault(ids)`,
`setSmartRules(id, smartRulesJson)`, `createPlaylist(name): String`, `renamePlaylist(id, name)`,
`deletePlaylist(id)`, `addTrackToPlaylist(playlistId, trackId)`,
`removeTrackFromPlaylist(playlistId, trackId)`, `reorderPlaylist(playlistId, trackIds)`.

### `HistoryRepository` — [data/repo/HistoryRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/repo/HistoryRepository.kt)
`history: Flow<HistorySnapshot>`, `recordPlay(trackId)`, `addListenSeconds(trackId, seconds)`,
`clearRecents()`. `HistorySnapshot.toHistoryData()` adapts to the shared `HistoryData`
contract. ⚠️ Backed by the Android-only `play_history` aggregate table
([DATABASE.md §3.2](DATABASE.md#32-entities--entitieskt)).

### `StatsRepository` — [data/repo/StatsRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/repo/StatsRepository.kt)
`data: Flow<StatsData>` (a `combine` of sources), `recordSession(track, startedAtMs, seconds)` —
the write path that appends a `play_events` row and enqueues the `playEvent.add` op.

### `AuthRepository` — [data/cloud/AuthRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/cloud/AuthRepository.kt)
`sessionStatus: Flow<SessionStatus>`, `signIn(email, password)`, `signUp(email, password): Boolean`,
`signOut()`, `registerDevice()`, `deviceId(): String?`.

### `UploadManager` — [data/vault/UploadManager.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/UploadManager.kt)
The Android twin of core `uploadTrack`. `items`, `shared`, `sharedCover`, `running` (StateFlows
the upload screen renders); `addUris(uris)` (picker or share intake: copy, BLAKE3, tags, cover),
`setValue`, `setItemCover`, `setShared`, `setSharedCover`, `remove`, `clearFinished`, `start()`.

### `VaultApi` — [data/vault/VaultApi.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/VaultApi.kt)
The `vault` function client over OkHttp: `signGet(keys)`, `signGetOne(key)`,
`signPutAudio(trackId, ext)`, `signPutArt(sha256, variant, size)`, `commit(trackId, ext)`,
`remove(trackId)`, `resolveUploadTarget(contentHash)`, `putFile(…)` with progress,
`download(url)`, `downloadTo(url, dest, onProgress)` (returns the BLAKE3 of what it wrote).
Errors: `VaultException(status, code)` / `VaultNetworkException`.

### `DownloadRepository` — [data/vault/DownloadRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/DownloadRepository.kt)
`downloads: Flow<List<DownloadEntity>>`, `pinnedFileIds: Flow<Set<String>>`,
`activeWork: Flow<List<WorkInfo>>` (WorkManager, created lazily), `enqueue(trackId)`,
`enqueueAll(trackIds)`, `cancel(trackId)`, `remove(trackId)`, `forgetDeleted(rows)`,
`download(trackId, onProgress)` — kept only if the bytes hash to the track's content hash.

### `VaultArtwork` — [data/vault/VaultArtwork.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/VaultArtwork.kt)
`sync()` fetches covers named by the synced rows into `filesDir/artwork/vault-<sha>.jpg`;
`adopt(artworkKey, file)` keeps a just-uploaded cover without re-downloading it.

### `SettingsRepository` — [data/prefs/SettingsRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/prefs/SettingsRepository.kt)
DataStore-backed. `settings: Flow<Settings>`, `current(): Settings`, plus per-field setters:
`setTheme`, `setAccent`, `setAmoled`, `setDynamicColor` (⚠️ Android-only), `setVolume`,
`setShuffle`, `setRepeat`, `setGapless`, `setCrossfadeSeconds`, `setEqPreset`, …

### `SyncManager` — [data/sync/SyncManager.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/SyncManager.kt)
`start()`, `consumeQueueHandoff(): QueueChange?` (one-shot read that nulls the value — the
cross-device queue handoff entry point).

### Playback — [playback/PlaybackController.kt](../apps/android/app/src/main/java/com/musicvault/playback/PlaybackController.kt)
The Media3 `MediaSessionService` boundary ([PlaybackService.kt](../apps/android/app/src/main/java/com/musicvault/playback/PlaybackService.kt));
`VaultPlayer` is the dual-ExoPlayer implementation.

### Kotlin ports of the shared API
`domain/SmartRules.kt`, `domain/SmartPlaylists.kt`, `domain/Stats.kt`, `domain/Albums.kt`,
`domain/Lrc.kt`, `domain/Format.kt` mirror their TypeScript namesakes; `data/sync/SyncEngine.kt`,
`SyncTypes.kt`, `SyncStorage.kt`, `SyncTransport.kt`, `Fractional.kt` mirror `packages/core/src/sync/`.
The contract is 1:1 semantics enforced by golden fixtures — [TESTING.md](TESTING.md).

---

# 5. Supabase interactions

Reads and writes go through these code paths — there is no other database access:

1. **`SupabaseSyncTransport`** — the `SyncTransport` implementation
   ([core/sync/transport.ts](../packages/core/src/sync/transport.ts) for desktop/web;
   [SupabaseSyncTransport.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/SupabaseSyncTransport.kt),
   364 lines, for Android). Everything in §2.4's port list.
2. **`core/supabase/*`** — auth and device registration (§2.2); plus the `resolve_upload_target`
   RPC and the `vault` function, both through the vault client (§2.5 / Android `VaultApi`).
3. **`@supabase/ssr`** on web — cookie-based session handling in
   [proxy.ts](../apps/web/src/proxy.ts) and [lib/supabase/server.ts](../apps/web/src/lib/supabase/server.ts).

Every query is implicitly scoped by RLS (`user_id = auth.uid()`); clients never filter by user id
themselves for security, only for efficiency. Upserts rely on the conflict targets created by
migrations 0002 and 0003; track edits go through the `apply_track_edit` RPC —
[DATABASE.md §1.1](DATABASE.md#11-migration-history).

---

# 6. The `vault` Edge Function

[supabase/functions/vault/](../supabase/functions/vault) — the only thing that holds R2 keys.
Every request is `POST { action, … }` with the caller's Supabase JWT.

| Action | Body | Returns | Notes |
|---|---|---|---|
| `sign-get` | `{ keys }` (≤ 200) | `{ urls, denied, expiresIn }` | GET URLs for 1 h; only the caller's keys that a live row or an artist photo references |
| `sign-put` | `{ kind: "audio", trackId, ext }` or `{ kind: "art", sha256, variant, size }` | `{ key, url, expiresIn }` | PUT URL for 15 min; 2 GiB audio / 5 MiB cover limits |
| `commit` | `{ trackId, ext }` | `{ trackId, storageKey, size }` | Confirms the object and its size, records `storage_key`, revives a deleted row |
| `delete` | `{ trackId }` | `{ trackId, deleted: true }` | `delete_track`, then removes the audio and a cover no other song or artist photo uses |

Errors come back as `{ error: <code>, message }` with an HTTP status. Details:
[VAULT.md](VAULT.md#the-vault-edge-function).
