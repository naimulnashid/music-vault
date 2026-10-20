# MusicVault Sync Protocol

> **Status: specified and implemented (Phase 4).** The reference implementation
> lives in `packages/core/src/sync/`; the Kotlin engine (Phase 6) must be a
> 1:1 port of the semantics described here. Conflict behavior is locked by the
> tests in `packages/core/tests/syncEngine.test.ts` — change semantics there
> and here in lockstep.

## Invariants

1. Audio bytes never touch Supabase — only metadata and user state.
2. Every client works offline; mutations queue in a persisted local outbox
   (SQLite on desktop/Android, IndexedDB on web) that survives crashes.
3. Every mutation carries a client-generated UUID → replays are idempotent.
4. `play_events` are append-only; nothing ever updates or deletes them.
5. User state merges: last-writer-wins on **`edited_at`** (client wall clock)
   per row; playlist ordering uses **fractional index strings** so concurrent
   reorders merge without rewriting sibling rows.
6. A sync cycle is: **flush outbox → pull since cursor → apply → save cursor**.
   Supabase Realtime shortcuts the pull while the app is running.

## Two timestamps per row

Every synced table carries two timestamps with distinct jobs:

| column       | set by                    | used for                          |
| ------------ | ------------------------- | --------------------------------- |
| `updated_at` | server (`set_updated_at` trigger) | pull cursors (monotonic per server) |
| `edited_at`  | client (op payload)       | last-writer-wins conflict resolution |

`updated_at` cannot be trusted for LWW because a device may flush an old
offline edit long after another device wrote a newer one. `edited_at` cannot
be trusted for cursors because client clocks skew. Using each for what it is
good at keeps both problems out of each other's way. LWW on client wall
clocks is an accepted trade-off for a single-user, few-devices system.

## Soft state, soft deletes

Row deletion is invisible to `updated_at > cursor` pulls, so nothing that
syncs is ever hard-deleted:

- **favorites** — row per (user, track) with a `favorite boolean`;
  un-favoriting sets `favorite = false`, never deletes.
- **ratings** — `rating = 0` means cleared (check is `0..5`).
- **playlists / playlist_items** — `deleted_at timestamptz` tombstone.
  Any later `upsert` with a newer `edited_at` sets `deleted_at = null`
  (an un-delete — rename-after-delete resurrects the playlist by design).
- **play_events** — append-only, cursor on server-set `created_at`.
- **queue_state / settings** — single/keyed rows overwritten in place.

## Outbox op envelope

```jsonc
{
  "id": "uuid",             // client-generated — the idempotency key
  "deviceId": "uuid|null",  // this install's devices.id row
  "createdAt": "ISO-8601",  // client clock when the op was queued
  "payload": { "kind": "...", ... }
}
```

Op kinds (`packages/core/src/sync/types.ts` is normative):

| kind                | payload                                                        |
| ------------------- | -------------------------------------------------------------- |
| `favorite.set`      | `track: TrackRef, favorite, editedAt`                          |
| `rating.set`        | `track: TrackRef, rating (0 clears), editedAt`                 |
| `playlist.upsert`   | `playlist {id, parentId, name, isFolder, isSmart, smartRules, position}, editedAt` |
| `playlist.delete`   | `playlistId, editedAt`                                         |
| `playlistItem.add`  | `playlistId, track: TrackRef, prevTrack?, nextTrack?, editedAt` |
| `playlistItem.remove` | `playlistId, track: TrackRef, editedAt`                      |
| `playlist.reorder`  | `playlistId, tracks: TrackRef[] (full desired order), editedAt` |
| `setting.set`       | `scope ('global' or device id), key, value, editedAt`          |
| `queue.set`         | `tracks: TrackRef[] (empty clears the queue), currentIndex, positionSeconds, shuffle, repeat, editedAt` |
| `track.edit`        | `track: TrackRef, patch {column: value, …} (editable fields only), editedAt` |
| `playEvent.add`     | `eventId, track: TrackRef, playedAt, durationPlayed, completed` |

### TrackRef — referencing tracks that may not exist remotely yet

Ops never carry raw Supabase `tracks.id` values only; an op may be queued
before the device has learned the row's id. A `TrackRef` carries every
identity it knows plus minimal metadata:

```jsonc
{
  "remoteId": "uuid?",       // known Supabase tracks.id (fast path)
  "contentHash": "string?",  // BLAKE3 identity
  "fileName": "...", "fileSize": 0, "title": "...", "artist": "...",
  "album": "...", "duration": 0   // enough to create a minimal row
}
```

Resolution order at flush time: `remoteId` → shadow/server lookup by
`contentHash` → **create** a minimal `tracks` row keyed by the hash (upsert on
`user_id, content_hash`, so racing devices converge). A ref with neither
identity is unsyncable and is not enqueued. Every vault track has both, so in
practice refs resolve on the fast path.

## Outbox flush

1. Load all ops ordered by `createdAt`.
2. **Coalesce**: for LWW entities (favorite/rating per track, setting per
   scope+key, queue singleton, playlist row per id, setItems per playlist)
   only the op with the newest `editedAt` survives; older ops are deleted
   unsent. `playEvent.add` is never coalesced.
3. Per op: resolve `TrackRef`s, then **conditional push**: read the remote
   row; if `remote.edited_at > op.editedAt` the op lost the conflict — drop
   it without writing. Otherwise upsert with `edited_at = op.editedAt`.
4. On success delete the op; on a network error stop the flush (offline —
   everything stays queued); on any other error bump `attempts` and continue
   with the next op. A cycle in which any op failed this way ends with phase
   `error` and that error as `lastError`, even when the pull succeeds; the
   next cycle with no failures clears it.
5. Android only, so far: a rejected session (HTTP 401, PGRST301, JWT expired,
   or no session at all) is not an op failure. The cycle stops without
   bumping `attempts`, refreshes the session once and runs again. If the
   refresh fails or the retry is rejected too, the engine pauses with phase
   `auth` until the app sees a new session. The app also pauses the engine
   while supabase-kt reports `RefreshFailure`, so nothing goes out with only
   the anon key. Core still treats these as ordinary op errors.

The read-then-write in step 3 is not transactional; two devices flushing the
same row in the same instant can still finish in either order. Accepted for
a single-user system (a later `security definer` RPC can close it).

Playlist membership and ordering use three ops so concurrent edits merge by
*intent* (an add on device B survives a reorder on device A):

- **`playlistItem.add`** — reads the current remote items; if the track is
  already live, done; if tombstoned, un-deletes (LWW). Otherwise inserts with
  `position = keyBetween(prevTrack's position, next live position)` using the
  anchors captured when the user dropped the track; missing/unresolvable
  anchors degrade to appending at the end.
- **`playlistItem.remove`** — soft-deletes exactly that `(playlist, track)`
  item, LWW-guarded on the item's `edited_at`. Nothing else is touched, so a
  remove never undoes another device's concurrent additions.
- **`playlist.reorder`** — carries the full desired order. Items whose
  existing positions already form an increasing subsequence in that order
  (greedy scan) keep their positions; only out-of-place items get fresh
  `keyBetween` keys, each LWW-guarded per item. Tracks added concurrently
  elsewhere are simply not mentioned and keep their positions.

Items are unique per `(playlist_id, track_id)` (a playlist cannot hold the
same track twice — all three clients already enforce this in their UI).

### Track metadata edits (`track.edit`)

Since the vault migration (0004_vault.sql) the `tracks` row is the source of
truth for descriptive metadata, edited from any client. Unlike the other LWW
entities the unit of conflict is the **field**, not the row:

- `tracks.field_edited_at` holds an edit clock per field. `apply_track_edit`
  writes each field of the patch only if the op's `editedAt` is at least as
  new as that field's clock (ties go to the incoming edit), then advances it.
  The read-modify-write is one SQL statement, so — unlike step 3 above — it
  has no race.
- Two devices editing **different** fields offline both keep their change;
  the same field resolves to the newest edit, whichever device flushes first.
- Coalescing key: `trackEdit/<trackRef key>/<sorted field names>` — an edit
  supersedes an older queued one only when both touch exactly the same fields.
- Only editable fields are accepted (`title`, `artist`, `album`, `genre`,
  `language`, `country`, `release_date`, `lyrics_text`, `lyrics_synced`,
  `artwork_key`); technical fields are read-only. `release_date` is "2019",
  "2019-05" or "2019-05-14", and writing it also sets `year` (its first four
  digits). Invalid patches are never enqueued.
- The server replies with the stored row; the client caches it in its shadow
  (so a lost field converges immediately, with a `flush.conflictLost`
  breadcrumb naming the fields). A track deleted elsewhere (`P0002`) drops the op.
- Until an edit flushes, clients show the pulled row with their pending
  edits overlaid (`overlayTrackEdits` / `TrackEdit.overlay`).

The rule is implemented three times — `apply_track_edit` (SQL),
`applyTrackEdit` (packages/core/src/trackFields.ts) and `TrackEdit.apply`
(Kotlin) — all pinned by `docs/fixtures/track-edit.golden.json`
(`supabase/tests/track_edit_golden.mjs` runs it against the SQL function).

### Tombstones and merges

Track rows are tombstoned (`deleted_at`), never hard-deleted, so cursor pulls
see deletions. A merge (`merge_tracks`, folding one row's history into
another) leaves the duplicate as a tombstone with `merged_into` pointing at
the survivor. Engines follow `merged_into` when resolving a `TrackRef`, so an
op queued against the duplicate lands on the surviving row.

## Pull

Per-table cursors (ISO timestamps, stored client-side) over `updated_at`
(`created_at` for `play_events`). Pull order matters: `tracks` first so every
later table's `track_id` can resolve against the track shadow:

`tracks → playlists → playlist_items → favorites → ratings → settings →
queue_state → play_events`

Apply rules:

- A pulled row is skipped (not applied locally) when a **pending outbox op**
  for the same entity has `editedAt >= row.edited_at` — local unflushed edits
  win locally until they get their shot at the server.
- Applied rows land in the **shadow** (a local mirror of remote state, table
  `sync_shadow` on desktop) and are surfaced to the app as change events.
- The cursor advances to the max `updated_at` seen, applied or skipped.
- Sign-in / startup does one **full pull** (`since = null`) as a safety net —
  cursor pulls + Realtime handle steady state, the full pull heals any gap
  (e.g. rows that committed with an `updated_at` below an already-advanced
  cursor).
- A full pull also **prunes the tracks shadow** to exactly the rows it
  returned, so a row removed on the server by hand (an admin cleanup)
  disappears locally too.
- Pulls are **paged** (1,000 rows per request, Supabase's response cap),
  ordered by the cursor column then the primary key, so a full pull always
  sees the whole table before pruning.

## Realtime

While running, the client subscribes to `postgres_changes` for every synced
table filtered on `user_id` and reacts to any event by scheduling a debounced
pull — Realtime is purely a *hint to pull sooner*; the pull/cursor path stays
the single way state enters a client, so a missed Realtime event costs
latency, never correctness.

## Queue handoff

`queue_state` is one LWW row per user: ordered `TrackRef`-resolved
`track_ids`, `current_index`, `position_seconds`, `shuffle`, `repeat`,
pushed debounced while playing. A client pulling a newer row than its own
last write surfaces it as a "continue from other device" state; it never
interrupts active local playback.

Clearing the queue is an ordinary `queue.set` with an empty `tracks` array —
`track_ids: []` means "there is nothing to hand off", not "no state". A client
must push it like any other queue edit, otherwise the last non-empty row keeps
offering a queue the user already dismissed. Because a clear only ever *removes*
a handoff offer, receiving one needs no special handling: restore is already
gated on the local queue being empty, so an empty row resolves to zero tracks
and no restore happens. Note the distinction a pusher must preserve: a queue
whose tracks have no identity resolves to zero `TrackRef`s but is not a cleared
queue, and must not be pushed as one.

## Local state on a device

A device's library is a mirror of the account: playlists, favorites and
ratings come from the server, and nothing local is pushed up at sign-in.
Signing out (or signing in as a different account) clears the sync state and
the mirrored playlists, so one account's data never syncs into another.

## Diagnostics (breadcrumbs)

Both engines emit an observability-only breadcrumb trail — no sync semantics
attach to it, and the two implementations mirror events, not byte-identical
detail. Events: `cycle.start` / `cycle.end` (outcome, pending ops, duration),
`flush.coalesced`, `flush.opFailed` (kind, attempts, error), `flush.conflictLost`
(a local edit lost LWW), `pull.applied` (per-table counts), `enqueue.dropped`
(identity-less ref) and `realtime.hint`; Android adds `auth.rejected` and
`auth.refreshed`. The engine keeps the last 200 in a
ring buffer (`getBreadcrumbs()`); desktop also writes them to the rotating
appdata log (target `sync`), Android to logcat (`MVSync`), web to the console.
