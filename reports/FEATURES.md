# Feature Inventory

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; library, vault, caching and auth sections
> updated 2026-10-13 for the vault (Google Drive's replacement); caching, downloads, statistics,
> theming and UI updated 2026-10-15.
> Every claim cites the file (and line range where practical) that implements it. Status values:
> ✅ Implemented · ⚠️ Implemented with a platform gap · 🚧 Planned — not yet implemented.
> The platform-by-platform matrix is in [FEATURE_PARITY.md](FEATURE_PARITY.md); this document
> describes what each feature *is* and where it lives.

---

## Library

### Uploading to the vault
**Purpose** — Add songs by hand, from any app. Nothing uploads automatically.
**Status** ✅ All three platforms.
**Files** — shared orchestration `uploadTrack` in [core/upload.ts](../packages/core/src/upload.ts);
desktop [UploadDialog.tsx](../apps/desktop/src/components/UploadDialog.tsx) +
[uploadStore.ts](../apps/desktop/src/store/uploadStore.ts) over Rust
[vault/prepare.rs](../apps/desktop/src-tauri/src/vault/prepare.rs) (file picker, folders, or files
dropped on the window via [useFileDrop.ts](../apps/desktop/src/hooks/useFileDrop.ts)); web
[uploadStore.ts](../apps/web/src/store/uploadStore.ts) +
[uploadPrepare.ts](../apps/web/src/lib/uploadPrepare.ts) (file input or drag-and-drop); Android
[UploadManager.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/UploadManager.kt) +
[UploadScreen.kt](../apps/android/app/src/main/java/com/musicvault/ui/vault/UploadScreen.kt)
(system picker, or **Share → Music Vault** from another app).
**How** — each file is hashed (BLAKE3), its tags, technical facts and embedded cover are read, and
a form shows the details pre-filled for review (batch fields and a shared cover for several songs).
A file already in the vault is reported as such; a known song keeps its history. Full flow:
[VAULT.md § Uploading](VAULT.md#uploading).
**Dependencies** — desktop `lofty`, `blake3`, `image`, `walkdir`; web `music-metadata`,
`hash-wasm`; Android `jaudiotagger`, BLAKE3.

### Track details, edited online
**Status** ✅ All three platforms (`TrackEditor` on desktop/web,
[TrackEditor.kt](../apps/android/app/src/main/java/com/musicvault/ui/vault/TrackEditor.kt) on Android).
**What** — title, artist, album, genre, language, country, release date (a year, year and month,
or full date), plain and synced lyrics, and the cover are stored in the Supabase row and edited from any app,
one track or several at once. Technical facts (duration, codec, sample rate, bit depth, channels,
size, ReplayGain, hash) are read-only. Edits travel as `track.edit` sync ops with field-level
last-writer-wins ([core/trackFields.ts](../packages/core/src/trackFields.ts), Kotlin
`TrackEdit.kt`, SQL `apply_track_edit`), pinned by `docs/fixtures/track-edit.golden.json`.

### Delete from vault
**Status** ✅ All three platforms — track menu and multi-select, behind a confirmation.
**What** — removes the audio (and the cover if no other track uses it) and the track's ratings,
favorites, playlist entries and play history; the row becomes a tombstone that every device
pulls, and each device drops its downloaded copy.

### Library origin
**Status** ✅ The library on every client is a projection of the synced `tracks` rows that have
audio in the vault: desktop [vaultMerge.ts](../apps/desktop/src/lib/vaultMerge.ts)
(`projectVault`), web [trackMap.ts](../apps/web/src/lib/trackMap.ts) (`projectRows`), Android
[VaultMerge.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/VaultMerge.kt).
Queued edits are laid over their rows so they show before they flush. There is no local-file or
folder library on any platform.

### Content hashing (track identity)
**Status** ✅ BLAKE3 of the audio is the track's identity everywhere — computed at upload
([scan/hash.rs](../apps/desktop/src-tauri/src/scan/hash.rs), `hash-wasm` on the web, BLAKE3 on
Android) and unique per user in Supabase `tracks`. The database enforces it for every live row:
`check (deleted_at is not null or content_hash is not null)`
([0005_drop_drive.sql](../supabase/migrations/0005_drop_drive.sql)). Downloads are verified
against it.

### Browse & search
**Status** ✅ Albums/artists/genre/year/language grouping via
[core/albums.ts](../packages/core/src/albums.ts) and
[core/smartPlaylists.ts:85-104](../packages/core/src/smartPlaylists.ts) (`computeSmartGroups`);
search + sort (`title`/`artist`/`album`) in each `libraryStore`
([web:14](../apps/web/src/store/libraryStore.ts)).

### Virtualized lists
**Status** ✅ **Files** — `useVirtualRows` on desktop
([hooks/useVirtualRows.ts](../apps/desktop/src/hooks/useVirtualRows.ts)) and web
([hooks/useVirtualRows.ts](../apps/web/src/hooks/useVirtualRows.ts)), described as 1:1 and
"50k-ready" ([docs/architecture.md:152-155](../docs/architecture.md)). Android uses Compose's
natively-lazy lists ([TrackList.kt](../apps/android/app/src/main/java/com/musicvault/ui/components/TrackList.kt)).

---

## Playback

Three independent engines — this is the least-shared subsystem in the project, by necessity.

### Desktop engine (Rust)
**Status** ✅ **Pipeline** — Symphonia decode → 10-band EQ → resample → cpal/WASAPI.
**Files** — [audio/engine.rs](../apps/desktop/src-tauri/src/audio/engine.rs) (526),
[audio/decoder.rs](../apps/desktop/src-tauri/src/audio/decoder.rs) (615),
[audio/output.rs](../apps/desktop/src-tauri/src/audio/output.rs) (cpal),
[audio/eq.rs](../apps/desktop/src-tauri/src/audio/eq.rs) (biquad),
[audio/resampler.rs](../apps/desktop/src-tauri/src/audio/resampler.rs) (rubato),
[audio/analyzer.rs](../apps/desktop/src-tauri/src/audio/analyzer.rs) (rustfft).
**Formats** — mp3, flac, wav, pcm, ogg, vorbis, isomp4, aac, alac via Symphonia features
([Cargo.toml](../apps/desktop/src-tauri/Cargo.toml)); `.ape` via `ape-decoder`; `.wv` via
vendored libwavpack ([audio/wv.rs](../apps/desktop/src-tauri/src/audio/wv.rs) + `vendor/wavpack`).
**Threading** — `rtrb` ring buffer + `crossbeam-channel`; the mixer thread is shut down cleanly
on exit ([lib.rs:205-211](../apps/desktop/src-tauri/src/lib.rs)).

### Android engine (Media3)
**Status** ✅ **Files** — [VaultPlayer.kt](../apps/android/app/src/main/java/com/musicvault/playback/VaultPlayer.kt)
(694 lines on 2026-10-22: dual-ExoPlayer for gapless/crossfade),
[PlaybackService.kt](../apps/android/app/src/main/java/com/musicvault/playback/PlaybackService.kt)
(MediaSessionService),
[PlaybackController.kt](../apps/android/app/src/main/java/com/musicvault/playback/PlaybackController.kt),
[EqController.kt](../apps/android/app/src/main/java/com/musicvault/playback/EqController.kt),
[QueueState.kt](../apps/android/app/src/main/java/com/musicvault/playback/QueueState.kt),
[VaultDataSource.kt](../apps/android/app/src/main/java/com/musicvault/playback/VaultDataSource.kt).
APE and WavPack: extractors in [playback/formats](../apps/android/app/src/main/java/com/musicvault/playback/formats),
decoded by FFmpeg through the [`:ffmpeg` module](../apps/android/ffmpeg/README.md) (Media3's FFmpeg
extension, cut down to those two decoders; `FfmpegAudioRenderer` is preferred over MediaCodec).

### Web engine (Web Audio)
**Status** ✅ **Files** — [lib/audioEngine.ts](../apps/web/src/lib/audioEngine.ts),
[hooks/useAudioEngine.ts](../apps/web/src/hooks/useAudioEngine.ts),
[hooks/useMediaSession.ts](../apps/web/src/hooks/useMediaSession.ts) (Media Session API).

### Transport, queue, shuffle, repeat
**Status** ✅ Shared contract: `RepeatMode = "off" | "one" | "all"`
([core/types.ts:55](../packages/core/src/types.ts)). Desktop commands `player_load/play/pause/
stop/seek/set_volume` ([commands/player.rs](../apps/desktop/src-tauri/src/commands/player.rs));
queue panels on desktop/web ([QueuePanel.tsx](../apps/desktop/src/components/QueuePanel.tsx)),
Android [QueueState.kt](../apps/android/app/src/main/java/com/musicvault/playback/QueueState.kt)
persisted in the Room `queue_items` table
([Entities.kt:81-85](../apps/android/app/src/main/java/com/musicvault/data/db/Entities.kt)).

### Gapless & crossfade
**Status** ✅ Desktop `player_set_gapless` / `player_set_crossfade`
([commands/player.rs:51-59](../apps/desktop/src-tauri/src/commands/player.rs)); Android dual-player
crossfade in `VaultPlayer.kt`. Settings `gapless` + `crossfadeDuration` are synced
([core/types.ts:92-94](../packages/core/src/types.ts)).

### 10-band equalizer
**Status** ✅ Bands `[31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]` Hz and presets
Flat / Bass Boost / Vocal / Treble Boost are defined once for all clients at
[core/types.ts:104-111](../packages/core/src/types.ts). UI:
[EqualizerPanel.tsx](../apps/desktop/src/components/EqualizerPanel.tsx) (desktop/web),
[EqualizerSheet.kt](../apps/android/app/src/main/java/com/musicvault/ui/player/EqualizerSheet.kt).

### ReplayGain
**Status** ⚠️ Synced everywhere, **applied on desktop only** — stated in the type comment
"ReplayGain volume normalization (synced; only desktop applies it)"
([core/types.ts:96-97](../packages/core/src/types.ts)). Modes `off | track | album`
([types.ts:58](../packages/core/src/types.ts)); the desktop engine applies a per-stream linear
gain inside `StreamState::pull` so it stays per-track-correct across gapless splices
([docs/architecture.md:121-124](../docs/architecture.md)); command `player_set_rg`
([commands/player.rs:70](../apps/desktop/src-tauri/src/commands/player.rs)).

### Visualizer
**Status** ✅ Desktop FFT via `rustfft` ([audio/analyzer.rs](../apps/desktop/src-tauri/src/audio/analyzer.rs),
toggled by `player_set_visualizer` at [commands/player.rs:75](../apps/desktop/src-tauri/src/commands/player.rs));
web [Visualizer.tsx](../apps/web/src/components/Visualizer.tsx); Android
[VisualizerSheet.kt](../apps/android/app/src/main/java/com/musicvault/ui/player/VisualizerSheet.kt).

### Lyrics (plain + synced LRC)
**Status** ✅ Parser shared: [core/lrc.ts](../packages/core/src/lrc.ts) ported to
[domain/Lrc.kt](../apps/android/app/src/main/java/com/musicvault/domain/Lrc.kt), both covered by
tests ([lrc.test.ts](../packages/core/tests/lrc.test.ts),
[LrcTest.kt](../apps/android/app/src/test/java/com/musicvault/domain/LrcTest.kt)). UI:
`LyricsPanel.tsx` (desktop/web), `LyricsSheet.kt` (Android).

### Sleep timer
**Status** ✅ [SleepTimer.tsx](../apps/desktop/src/components/SleepTimer.tsx) +
`sleepStore.ts` (desktop/web); [SleepTimerButton.kt](../apps/android/app/src/main/java/com/musicvault/ui/player/SleepTimerButton.kt).

### Mini player
**Status** ⚠️ Desktop only. A second frameless always-on-top webview (label `mini`) boots a
remote-control UI from the same bundle while the main window hides but keeps running as the
"brain"; state and commands flow over `mini://*` Tauri events.
**Files** — [MiniPlayer.tsx](../apps/desktop/src/components/MiniPlayer.tsx),
[lib/miniBridge.ts](../apps/desktop/src/lib/miniBridge.ts),
[hooks/useMiniBridge.ts](../apps/desktop/src/hooks/useMiniBridge.ts),
[commands/window.rs](../apps/desktop/src-tauri/src/commands/window.rs) (`mini_toggle`).
Destroying the mini window always restores main — handled in `on_window_event`
([lib.rs:194-202](../apps/desktop/src-tauri/src/lib.rs)).

### OS integration
**Status** ⚠️ Platform-specific by nature.
- Desktop: SMTC/media keys ([smtc.rs](../apps/desktop/src-tauri/src/smtc.rs), `souvlaki`), system
  tray ([tray.rs](../apps/desktop/src-tauri/src/tray.rs)), Windows jump list
  ([jumplist.rs](../apps/desktop/src-tauri/src/jumplist.rs), `ICustomDestinationList`). Tray and
  media keys share one dispatch path via the `smtc://control` channel
  ([docs/architecture.md:109-112](../docs/architecture.md)); jump-list tasks relaunch the exe with
  `--media-control=<action>` and are routed to the running instance by the single-instance plugin
  ([lib.rs:18-30](../apps/desktop/src-tauri/src/lib.rs)). All three degrade gracefully — each is
  wrapped in a warn-and-continue ([lib.rs:106-125](../apps/desktop/src-tauri/src/lib.rs)).
- Android: MediaSessionService notification + Android Auto descriptor
  ([res/xml/automotive_app_desc.xml](../apps/android/app/src/main/res/xml/automotive_app_desc.xml)).
- Web: Media Session API ([useMediaSession.ts](../apps/web/src/hooks/useMediaSession.ts)).

---

## The vault

Full treatment in [VAULT.md](VAULT.md); summary only here.

| Feature | Status | Desktop | Android | Web |
|---|---|---|---|---|
| Upload (manual, reviewed) | ✅ | [UploadDialog.tsx](../apps/desktop/src/components/UploadDialog.tsx), [vault/prepare.rs](../apps/desktop/src-tauri/src/vault/prepare.rs) | [UploadManager.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/UploadManager.kt), share intake | [uploadPrepare.ts](../apps/web/src/lib/uploadPrepare.ts) |
| Edit details / covers | ✅ | `TrackEditor.tsx` | `TrackEditor.kt` | `TrackEditor.tsx` |
| Delete from vault | ✅ | [vaultActions.ts](../apps/desktop/src/lib/vaultActions.ts) | `LibraryRepository.deleteFromVault` | [vaultActions.ts](../apps/web/src/lib/vaultActions.ts) |
| Signed URLs | ✅ | [lib/vault.ts](../apps/desktop/src/lib/vault.ts) (core client) | [VaultApi.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/VaultApi.kt) | [lib/vault.ts](../apps/web/src/lib/vault.ts) (core client) |
| Verified download | ✅ | [vault/transfer.rs](../apps/desktop/src-tauri/src/vault/transfer.rs) | pinned: [DownloadRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/DownloadRepository.kt) | [audioCache.ts](../apps/web/src/lib/audioCache.ts) |
| Covers by key | ✅ | `fetchVaultArt` | [VaultArtwork.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/VaultArtwork.kt) | [artwork.ts](../apps/web/src/lib/artwork.ts) |
| "Download all" | ⚠️ Desktop only | Downloads view | — | — |

---

## Caching

### Two-tier model
**Status** ✅ **Purpose** — enforce the "audio never streams twice" principle
([docs/architecture.md:26-27](../docs/architecture.md)).
1. **Auto-cache** — filled by playing a track; LRU-evicted under a configurable cap.
2. **Pinned downloads** — explicit downloads; never auto-evicted.

Resolution order: pinned download → cache → download-then-play from a signed URL
([docs/architecture.md](../docs/architecture.md#cache--downloads-two-tiers);
desktop `ensureVaultLocal` in [lib/vault.ts](../apps/desktop/src/lib/vault.ts)).

**Files** — desktop [vault/cache.rs](../apps/desktop/src-tauri/src/vault/cache.rs) with the
tiers rooted at distinct directories declared in
[commands/mod.rs:18-24](../apps/desktop/src-tauri/src/commands/mod.rs) (`audio_cache_dir` =
"LRU-evicted", `downloads_dir` = "never auto-evicted"); the LRU index is
`cache_entries(pinned, last_access)`, keyed `vault:<hash>` ([db/mod.rs](../apps/desktop/src-tauri/src/db/mod.rs)).
Android: tier 1 is Media3 `SimpleCache` (needs no Room bookkeeping), tier 2 is the `downloads`
table — stated at [Entities.kt:155-160](../apps/android/app/src/main/java/com/musicvault/data/db/Entities.kt).
Web: OPFS bytes + IndexedDB bookkeeping with `tier: "cache" | "pin"` and the copy's hash
([lib/db.ts:10-32](../apps/web/src/lib/db.ts), [lib/audioCache.ts](../apps/web/src/lib/audioCache.ts)).
**Cap**: Off, 1, 2, 5 or 10 GB, and never more than 10 GiB; each device keeps its own (defaults:
desktop 10 GiB, Android 2 GiB, web 4 GiB). Desktop and web never evict the two most recently used
cached songs (the one playing and the one preloaded after it), so Off keeps just those
(`KEEP_RECENT` in [vault/cache.rs](../apps/desktop/src-tauri/src/vault/cache.rs) and
[lib/audioCache.ts](../apps/web/src/lib/audioCache.ts)). Android streams without the cache when
it is Off, and applies a new cap at once through its own LRU evictor that reads the cap on every
eviction ([AudioCache.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/AudioCache.kt)).
**Clear cache**: a button beside the cap empties the auto tier; pinned downloads stay.
**Commands** — `vault_cache_stats`, `vault_cache_set_max` (clamped to 0..10 GiB), `vault_cache_clear`,
`vault_downloads_list`, `vault_download_remove`, `vault_download_cancel`, `vault_forget_deleted`
([commands/vault.rs](../apps/desktop/src-tauri/src/commands/vault.rs)).

### Artwork thumbnails
**Status** ✅ Every vault cover is uploaded with a 256 px `.thumb.jpg` beside the full image
([vault/prepare.rs](../apps/desktop/src-tauri/src/vault/prepare.rs), web canvas, Android Bitmap);
desktop list rows and grids load the thumb ([AlbumArt.tsx](../apps/desktop/src/components/AlbumArt.tsx)),
the web caches covers and thumbs in IndexedDB ([lib/artwork.ts](../apps/web/src/lib/artwork.ts)),
Android uses Coil over the cached files.

---

## Ratings (retired)

**Status** ⛔ Star ratings were removed from all three apps on 2026-10-13 (owner decision): no
rating control anywhere, no `rating.set` ops sent, and "Rating" left the smart-rule builder (a saved
rule that still names it counts it as never set). The `ratings` table, the sync engine's pull path
and the `rating` columns stay so older builds keep working — nothing reads them any more.

## Favorites

**Favorites** use soft state: `favorite boolean not null default true`
added in [0003_sync.sql:12-14](../supabase/migrations/0003_sync.sql) because "deletions are
invisible to updated_at cursors".

---

## Playlists

**Status** ✅ Manual playlists with drag-and-drop ordering (`@dnd-kit` on desktop/web).
**Files** — `PlaylistView.tsx` (desktop/web),
[PlaylistScreen.kt](../apps/android/app/src/main/java/com/musicvault/ui/screens/PlaylistScreen.kt);
desktop commands `playlists_get_all/create/rename/delete/set_tracks/set_rules`
([commands/playlists.rs](../apps/desktop/src-tauri/src/commands/playlists.rs)).
**Ordering** — Supabase stores `position` as a **fractional index string** (default `'a0'`) so
concurrent reorders merge without rewriting siblings
([0001_init.sql:144](../supabase/migrations/0001_init.sql),
[core/sync/fractional.ts](../packages/core/src/sync/fractional.ts) + its Kotlin port
[Fractional.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/Fractional.kt)).
Local clients store an integer `position` ([db/mod.rs:154-159](../apps/desktop/src-tauri/src/db/mod.rs))
and translate at the sync boundary.
**Folders** — Supabase supports playlist folders (`is_folder`, `parent_id`,
[0001_init.sql:136-147](../supabase/migrations/0001_init.sql)) and the sync snapshot carries
`isFolder`/`parentId` ([core/sync/types.ts:53-62](../packages/core/src/sync/types.ts)), but **no
client has a folder UI** — the desktop `playlists` table has no `parent_id`/`is_folder` column at
all ([db/mod.rs:64-68, 100-101](../apps/desktop/src-tauri/src/db/mod.rs)). 🚧 Schema-ready, not
implemented.
**Track ids** — `playlist_tracks` has no FK to a local tracks table (there is none since SQLite
v9): entries hold library ids (`vault:<hash>` on desktop and Android, row ids on the web), mapped
from the synced `playlist_items`.

---

## Smart Playlists

Two distinct systems, easy to confuse:

### 1. Built-in smart playlists
**Status** ✅ Ten fixed definitions: `recentlyAdded`, `recentlyPlayed`, `mostPlayed`,
`favorites`, `neverPlayed` (kind `list`) and `artist`, `genre`, `year`, `language`, `country`
(kind `group`), in [core/smartPlaylists.ts](../packages/core/src/smartPlaylists.ts), computed by
`computeSmartTracks` and `computeSmartGroups`. A comma in an artist or genre tag separates two
names (`splitNames`), so a song appears in each of their groups; `hasArtist` matches artist pages
the same way. Kotlin port:
[domain/SmartPlaylists.kt](../apps/android/app/src/main/java/com/musicvault/domain/SmartPlaylists.kt).

### 2. Rule-based smart playlists (Phase 2)
**Status** ✅ A JSON rule **AST** — nested AND/OR groups of field/op/value conditions plus optional
sort and limit ([core/smartRules.ts:63-80](../packages/core/src/smartRules.ts)).
- **12 fields**: title, artist, album, genre, language, country, year, duration,
  playCount, addedAt, lastPlayedAt, favorite ([smartRules.ts](../packages/core/src/smartRules.ts)).
  A saved rule naming a retired field (albumArtist, composer, bpm, trackNo, discNo, rating) counts it as
  never set.
- **21 operators** across string / number / date / presence / boolean families
  ([smartRules.ts:32-53](../packages/core/src/smartRules.ts)). Date values are epoch ms;
  `inLast` counts days back from `now`; `between` is inclusive on both ends.
- **Storage**: the JSON is stored verbatim per client (`smart_rules` TEXT on desktop
  [db/mod.rs:101](../apps/desktop/src-tauri/src/db/mod.rs); `smartRules` on Room
  [Entities.kt:52-53](../apps/android/app/src/main/java/com/musicvault/data/db/Entities.kt);
  `smart_rules jsonb` on Supabase [0001_init.sql:143](../supabase/migrations/0001_init.sql)).
- **Editor UI**: `SmartRulesEditor` on all three clients (desktop/web `.tsx`, Android
  [components/SmartRulesEditor.kt](../apps/android/app/src/main/java/com/musicvault/ui/components/SmartRulesEditor.kt), 351 lines).
**Contract** — the file header is explicit: change semantics here and you must update the Kotlin
port and the fixtures together ([smartRules.ts:1-9](../packages/core/src/smartRules.ts)).
Evaluation input is platform-neutral (`RuleTrackInput`): duration in seconds, timestamps in epoch
ms.

---

## Statistics

**Status** ✅ (⚠️ Recap — see below). **Purpose** — derive all listening statistics from an
append-only event stream; there is **no play-count column** anywhere in Supabase
([0001_init.sql:208-212](../supabase/migrations/0001_init.sql)).

**Engine** — [core/stats.ts](../packages/core/src/stats.ts) (474 lines), a pure function library
ported 1:1 to [domain/Stats.kt](../apps/android/app/src/main/java/com/musicvault/domain/Stats.kt)
(460) and pinned by [docs/fixtures/stats.golden.json](../docs/fixtures/stats.golden.json).
Public surface:

| Function | Purpose |
|---|---|
| `dedupeEvents` ([:103](../packages/core/src/stats.ts)) | Merge local log + sync shadow by event id |
| `filterRange` / `rangeForPreset` ([:117, :139](../packages/core/src/stats.ts)) | Presets `last7Days`, `last30Days`, `last90Days`, `thisYear`, `allTime` |
| `summarize` ([:164](../packages/core/src/stats.ts)) | Range summary |
| `rankTracks` / `rankGroups` ([:230, :259](../packages/core/src/stats.ts)) | Top tracks and top albums, artists, genres, years, languages, countries, ranked `by: "plays" \| "time"`; comma-separated artists and genres each get the play |
| `rankDevices` | Listening per `play_events.device_id` (the device donut) |
| `bucketize` ([:307](../packages/core/src/stats.ts)) | Day/month/year buckets → charts + calendar heatmap |
| `hourHistogram` ([:325](../packages/core/src/stats.ts)) | Listening clock |
| `computeStreaks` ([:348](../packages/core/src/stats.ts)) | Current/longest streaks |
| `computeRecap` / `recapYears` ([:415, :470](../packages/core/src/stats.ts)) | Wrapped-style yearly recap |

**Timezone** — bucketing goes through a pluggable `StatsZone`
([:47-51](../packages/core/src/stats.ts)) so tests use `fixedOffsetZone` (deterministic) while
clients use `systemZone()` (local-midnight-correct).
**`completed`** means ">= 90% of the track was heard" ([:22-23](../packages/core/src/stats.ts)).

**Event log per client** — desktop SQLite `play_events`
([db/mod.rs:188-206](../apps/desktop/src-tauri/src/db/mod.rs)), web IndexedDB `mv-stats`
([playEventLog.ts](../apps/web/src/lib/playEventLog.ts)), Android Room `play_events`
([Entities.kt:87-103](../apps/android/app/src/main/java/com/musicvault/data/db/Entities.kt)). All
three carry the same comment: the log is device-owned and **deliberately not wiped on sign-out**,
unlike `sync_*`. Idempotency is proven by a test —
inserting the same event id twice leaves one row
([db/mod.rs:302-318](../apps/desktop/src-tauri/src/db/mod.rs)).

**On screen**: a range selector, summary cards, an activity chart and a listening clock (both
with a time axis), the last 6 months as a calendar heatmap (26 Saturday-first week columns, month
and weekday labels, a Less/More scale), top-5 lists two per row (albums and artists, genres and
years, countries and languages), a play-time-by-device donut and the top tracks, each in its own
card. Device names come from the `devices` table (id and name only). **Expand** opens Listening History: every 6-month block since
1 January of the first year with plays, on one shared colour scale
([Heatmap.tsx](../apps/desktop/src/components/Heatmap.tsx), the same file on web;
[HeatmapScreen.kt](../apps/android/app/src/main/java/com/musicvault/ui/screens/HeatmapScreen.kt)).
On desktop and web every chart shares one hover tooltip in the seek bar's style, drawn in a
portal so a scroller never clips it ([ChartTooltip.tsx](../apps/desktop/src/components/ChartTooltip.tsx)),
and heatmap squares grow under the pointer. On Android the heatmap is view-only, since its
squares are too small to tap.

**Recap UI** — ⚠️ desktop + web only ([RecapView.tsx](../apps/desktop/src/components/RecapView.tsx),
[RecapView.tsx](../apps/web/src/components/RecapView.tsx)). Android has the **engine** ported
(`Stats.Recap`, `computeRecap`, `recapYears` at
[Stats.kt:380-458](../apps/android/app/src/main/java/com/musicvault/domain/Stats.kt)) but no
screen references it — verified by grep across
[StatsScreen.kt](../apps/android/app/src/main/java/com/musicvault/ui/screens/StatsScreen.kt),
[StatsViewModel.kt](../apps/android/app/src/main/java/com/musicvault/ui/StatsViewModel.kt) and
[StatsRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/repo/StatsRepository.kt).
The Kotlin recap code is currently unreachable.

> ⚠️ Android also keeps a `play_history` aggregate table (`playCount`, `listenSeconds`,
> `lastPlayedAt`) alongside the event log
> ([Entities.kt:67-78](../apps/android/app/src/main/java/com/musicvault/data/db/Entities.kt)) —
> a pre-Phase-7 structure the other clients don't have. It is not synced.

---

## Sync

Full protocol: [docs/sync-protocol.md](../docs/sync-protocol.md); API: [API.md](API.md#sync-engine).

**Status** ✅ **Files** — [core/sync/engine.ts](../packages/core/src/sync/engine.ts) (872) and the
Kotlin port [SyncEngine.kt](../apps/android/app/src/main/java/com/musicvault/data/sync/SyncEngine.kt) (785).

**Model** ([docs/architecture.md:79-85](../docs/architecture.md), verified in code):
- `play_events` append-only → no conflicts by construction.
- Favorites / ratings / settings → last-writer-wins on `edited_at`.
- Playlist ordering → fractional indexes, so concurrent reorders merge.
- Every mutation gets a client-generated UUID → idempotent replay
  ([core/sync/types.ts:101-107](../packages/core/src/sync/types.ts): "`id` is the idempotency key").
- The outbox persists locally and survives crashes (desktop `sync_outbox`
  [db/mod.rs:165-171](../apps/desktop/src-tauri/src/db/mod.rs); Room `sync_outbox`; web IndexedDB
  `mv-sync` — "queued mutations survive tab closes and reloads (the 'no data loss' invariant)"
  [syncStorage.ts:35-38](../apps/web/src/lib/syncStorage.ts)).
- Supabase Realtime pushes "pull sooner" hints; the publication covers 8 tables
  ([0003_sync.sql:81-89](../supabase/migrations/0003_sync.sql)).

**Op kinds** (10) — `favorite.set`, `rating.set`, `playlist.upsert`, `playlist.delete`,
`playlistItem.add`, `playlistItem.remove`, `playlist.reorder`, `setting.set`, `queue.set`,
`playEvent.add` ([core/sync/types.ts:64-97](../packages/core/src/sync/types.ts)).

**Coalescing** — ops sharing an `opEntityKey` target the same LWW row so only the newest flushes;
play events return a per-op key and never coalesce
([core/sync/types.ts:109-136](../packages/core/src/sync/types.ts)).

**Queue handoff** — one `queue_state` row per user
([0001_init.sql:256-268](../supabase/migrations/0001_init.sql)) carrying `track_ids`,
`current_index`, `position_seconds`, `shuffle`, `repeat`.

**Diagnostics** — breadcrumbs (`cycle.start`, `cycle.end`, `flush.coalesced`, `flush.opFailed`,
`flush.conflictLost`, `pull.applied`, `enqueue.dropped`, `realtime.hint`) at
[core/sync/types.ts:213-230](../packages/core/src/sync/types.ts); they are "observability only —
they carry no sync semantics, and the Kotlin port mirrors the emit points loosely". Desktop routes
them through the `sync_breadcrumb` command
([commands/sync.rs:89](../apps/desktop/src-tauri/src/commands/sync.rs)) into the appdata log.

---

## Settings

**Status** ✅ **Shape** — one `Settings` interface for every client
([core/types.ts:84-102](../packages/core/src/types.ts)): `theme`, `accent`, `eqPreset`, `eqBands`,
`volume`, `shuffle`, `repeat`, `gapless`, `crossfadeDuration`, `notificationsEnabled`,
`replayGainMode`, `amoled`, `followSystemTheme`.
**Scoping** — Supabase `settings` is keyed `(user_id, scope, key)` where scope is `'global'` or a
device id, "so per-device overrides (e.g. EQ) can coexist with account-wide settings (e.g. theme)"
([0001_init.sql:234-245](../supabase/migrations/0001_init.sql)).
**Device-local (never synced)** — `amoled` and `followSystemTheme` are explicitly marked
"device-local, never synced" ([core/types.ts:98-101](../packages/core/src/types.ts)).
**Storage** — desktop `settings` key/value table
([db/mod.rs:77-80](../apps/desktop/src-tauri/src/db/mod.rs)) via `settings_get`/`settings_set`;
Android DataStore ([SettingsRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/prefs/SettingsRepository.kt));
web IndexedDB `settings` store ([lib/db.ts:23-32](../apps/web/src/lib/db.ts)).

### Theming
**Status** ⚠️ **Files** — `useTheme.ts` / `ThemeSwitcher.tsx` (desktop/web),
[ui/theme/Theme.kt](../apps/android/app/src/main/java/com/musicvault/ui/theme/Theme.kt).
`theme` is `dark | light`, with device-local follow-system and pure-black AMOLED on all three
apps. Since the 2026-10-13 redesign every client uses one accent, Vibrant Violet `#8B5CF6`, and
the Figtree typeface; accent presets, the custom accent picker and Android's Material You colour
are gone. The synced `accent` field stays in the `Settings` shape so older builds can still
write it, but nothing applies it ([useTheme.ts](../apps/desktop/src/hooks/useTheme.ts)).

---

## Downloads

**Status** ✅ **Files** — `DownloadsView.tsx` (desktop/web),
[DownloadsScreen.kt](../apps/android/app/src/main/java/com/musicvault/ui/screens/DownloadsScreen.kt);
`DownloadAllButton.tsx` (desktop/web) for song/album/artist/playlist bulk pinning.
Android runs downloads through **WorkManager**
([DownloadWorker.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/DownloadWorker.kt),
[DownloadRepository.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/DownloadRepository.kt)),
so they survive app death — desktop/web downloads are in-process. Copies of tracks deleted from the
vault (on any device) are removed automatically.
**One queue**: desktop and web run every pinned download through one queue in
[store/downloadStore.ts](../apps/desktop/src/store/downloadStore.ts) (desktop: 4 at a time; web:
one at a time); Android queues one WorkManager job per song.
**Collection button**: the Download button on an album, artist, playlist or group shows how many
songs are done and left while it runs; a click (tap on Android) then **cancels**: queued songs
leave the queue and in-flight transfers stop (desktop: the Rust download checks a cancel set
every chunk; web: an `AbortController`; Android: `cancelUniqueWork`). Once everything is here, a
click removes the downloads ([DownloadAllButton.tsx](../apps/desktop/src/components/DownloadAllButton.tsx),
`useCollectionDownload` in [lib/trackState.ts](../apps/desktop/src/lib/trackState.ts),
[CollectionHeader.kt](../apps/android/app/src/main/java/com/musicvault/ui/components/CollectionHeader.kt)).
A downloaded song shows a tick.
**Auto-download**: a device-local switch, "Download all songs automatically", on every client:
every vault song is pinned, songs added later follow, songs deleted from the vault lose their
copies as before, and playback skips the auto-cache meanwhile (desktop/web
[downloadStore.ts](../apps/desktop/src/store/downloadStore.ts), Android
[AutoDownloader.kt](../apps/android/app/src/main/java/com/musicvault/data/vault/AutoDownloader.kt)).
The web app only downloads while it is open.
**Desktop and web extras**: live speed and an aggregate total in the Downloading section, and
"Download all" in the header.
**Library mirror (desktop)**: a folder of ordinary, tagged copies of every song for other players,
kept up to date after each sync; Choose folder, Mirror now, Change folder and Turn off on the
Downloads page ([store/mirrorStore.ts](../apps/desktop/src/store/mirrorStore.ts),
[vault/mirror.rs](../apps/desktop/src-tauri/src/vault/mirror.rs)). Details in
[VAULT.md](VAULT.md#library-mirror-desktop).

---

## Authentication

**Status** ✅ **Shared API** — [core/supabase/auth.ts](../packages/core/src/supabase/auth.ts):
`signUp`, `signIn`, `signOut`, `getSession`, `onAuthStateChange` (email/password only — no OAuth
social providers, no magic links anywhere in the codebase).
**Account required** — the library lives in the account, so the apps need Supabase settings. A
build without them says so (desktop account menu: "No account"; Android: "Music Vault needs an
account"); signed out, the library is empty.
**Profiles** — auto-created on signup by the `handle_new_user` trigger
([0001_init.sql:36-51](../supabase/migrations/0001_init.sql)).
**Devices** — registered per client, platform constrained to `('desktop','android','web')`
([0001_init.sql:55-62](../supabase/migrations/0001_init.sql));
[core/supabase/devices.ts](../packages/core/src/supabase/devices.ts).
**Web SSR** — session cookies are refreshed on every matched request by
[proxy.ts](../apps/web/src/proxy.ts), which also gates routes (public: `/login`, `/auth`, `/help`).
Web is the only client with server-rendered auth
([lib/supabase/server.ts](../apps/web/src/lib/supabase/server.ts) vs
[browser.ts](../apps/web/src/lib/supabase/browser.ts)).
**Isolation** — every table is RLS-protected with `user_id = auth.uid()` policies
([0001_init.sql](../supabase/migrations/0001_init.sql), smoke-tested by
[supabase/tests/rls_smoke.sql](../supabase/tests/rls_smoke.sql)). `play_events` has select+insert
policies **and no update/delete policies** — append-only enforced at the database
([0001_init.sql:225-229](../supabase/migrations/0001_init.sql)).

---

## UI

**Status** ✅ Desktop and web share a near-1:1 component set (47 components each, counted
2026-10-15); Android is an independent Compose implementation.
**Shell** — `Sidebar` + `ViewHeader` + `NowPlayingBar` (desktop/web);
[AppRoot.kt](../apps/android/app/src/main/java/com/musicvault/ui/AppRoot.kt) (top bar and
bottom navigation since the 2026-10-13 redesign; it replaced `VaultDrawer.kt`) on Android.
**Account menu**: the avatar at the top right opens it on every client: who is signed in, sync
status with Sync now, appearance, sign out (Android adds Upload music; the web adds Help)
([AccountMenu.tsx](../apps/desktop/src/components/AccountMenu.tsx),
[AccountMenu.kt](../apps/android/app/src/main/java/com/musicvault/ui/AccountMenu.kt)).
**Sidebar** (desktop/web): collapses to an icon rail that also lists the playlists. A playlist
with no cover shows the first letter of its name, plus a bracketed qualifier's initial
("Bangla (India)" reads B(I)); playlist pages and Android's Collections use a 2×2 mosaic of
four song covers ([Mosaic.tsx](../apps/desktop/src/components/Mosaic.tsx),
[Mosaic.kt](../apps/android/app/src/main/java/com/musicvault/ui/components/Mosaic.kt)).
**Player bar** (desktop/web): a click anywhere outside its controls opens the full player;
Lyrics, Sound, Queue and Clear queue have distinct icons (microphone, vertical sliders, list,
broom).
**Web addresses**: the address bar follows the page (`/albums`, `/album/<key>`,
`/artist/<name>`, `/playlist/<id>`, `/smart/<key>[/<group>]`, `/stats`, `/stats/recap`,
`/stats/history`, `/downloads`, `/search`), written with `history.pushState`; the optional
catch-all route `app/[[...view]]` serves those paths on reload, and the in-app Back button walks
the browser history ([lib/urlSync.ts](../apps/web/src/lib/urlSync.ts)).
**Installable web app** (since 2026-10-15): [app/manifest.ts](../apps/web/src/app/manifest.ts)
with regular and maskable icons; [public/sw.js](../apps/web/public/sw.js) keeps the app shell
(network first) and the build's static files, so the installed app opens offline and plays what
is downloaded; it never handles Supabase, R2, `/api` or the sign-in pages. The account menu
offers Install app when the browser does ([lib/pwa.ts](../apps/web/src/lib/pwa.ts)).
**Android volume**: a speaker button at the right of the full player's second row opens a
vertical slider showing the percentage while you drag; it sets the app's own volume, as the
desktop and web volume sliders do
([VolumeButton.kt](../apps/android/app/src/main/java/com/musicvault/ui/player/VolumeButton.kt)).
**State** — the same 11 Zustand stores on desktop and web (`library`, `player`, `download`,
`upload`, `sync`, `stats`, `history`, `auth`, `settings`, `sleep`, `ui`); Android uses Hilt-injected
ViewModels.
**Keyboard shortcuts** — `useKeyboardShortcuts.ts` (desktop/web only).
**Notifications** — `NotificationToggle` + `useNotifications` (desktop via
`tauri-plugin-notification`, web via the Notifications API).
**Errors** — `ErrorToast` + `errorBus.ts` (desktop/web).
**Lazy loading** — heavy web views (stats, recap, downloads, EQ, visualizer) are lazy chunks
([docs/architecture.md:156-157](../docs/architecture.md)).
**User docs** — a public `/help` page ships with the web app
([apps/web/src/app/help/page.tsx](../apps/web/src/app/help/page.tsx)); it is reachable signed-out
([proxy.ts:6-8](../apps/web/src/proxy.ts)).
