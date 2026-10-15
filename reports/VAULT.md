# The Vault (audio and covers)

> Written 2026-10-13 for `main` after the Drive → R2 migration (M0–M8). Replaces the former
> Google Drive report. Schema: [DATABASE.md](DATABASE.md) · Setup:
> [docs/vault-setup.md](../docs/vault-setup.md) · Design and history:
> [docs/drive-to-r2-migration.md](../docs/drive-to-r2-migration.md).

## Role

The vault is a single **private Cloudflare R2 bucket** (`musicvault`) holding each user's audio
and cover images. It holds bytes only. Everything that describes a track — title, artist, album,
genre, language, country, release date, lyrics (plain and synced)
and which cover it uses — lives in the track's Supabase row and is **edited online** from any app.
A file's own tags only pre-fill the upload form.

Nothing reaches R2 directly. Clients ask the **`vault` Edge Function** for short-lived pre-signed
URLs, and the bytes then go straight between the device and R2.

| Decision | Choice |
|---|---|
| What gets uploaded | Only what the owner uploads by hand — nothing automatic |
| Which apps upload | All three: desktop, Android, web |
| Who can delete from the vault | Every app, with a confirmation |
| Old Google Drive / local-folder libraries | Retired; the library was rebuilt from scratch |

---

## Object layout

```
users/<user-id>/audio/<blake3-hex>.<ext>         the audio, named by its content hash
users/<user-id>/art/<sha256-hex>.jpg             square JPEG cover (full size)
users/<user-id>/art/<sha256-hex>.thumb.jpg       256 px thumbnail for lists and grids
```

Objects are **immutable**: a name is a hash of the content, so a cached copy can never go stale and
two tracks with the same cover share one object. Accepted audio formats:
`mp3 flac wav ogg oga opus m4a mp4 aac alac aiff aif ape wv`. Limits: 2 GiB per audio file,
5 MiB per cover ([keys.ts](../supabase/functions/vault/keys.ts)).

---

## The `vault` Edge Function

[`supabase/functions/vault/`](../supabase/functions/vault/) — `index.ts` wires Supabase and R2,
`handler.ts` holds the logic (pure, unit-tested with vitest), `keys.ts` the key rules. JWT
verification is on; every request is `POST { action, ... }` with the caller's Supabase token. It
reads four secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

| Action | Does |
|---|---|
| `sign-get` | GET URLs (1 h) for up to 200 keys. Only the caller's own keys that a live track row references are signed; the rest come back as `denied`. Thumbnails resolve through their full cover. |
| `sign-put` | PUT URL (15 min) for an audio file of one of the caller's track rows (`kind: audio`), or for a cover by its SHA-256 and variant (`kind: art`). Size limits are checked here. |
| `commit` | After an audio upload: checks the object exists and matches the row's file size (a mismatch deletes it), then records `storage_key` and `uploaded_at` and clears `deleted_at` (a re-uploaded deleted track is revived). |
| `delete` | "Delete from vault": calls `delete_track`, then removes the audio and the cover if no other track of the user uses it. A failed object delete is logged; the key is unreachable anyway. |

Clients: `createSupabaseVaultApi` + `SignedUrlCache` in
[`packages/core/src/vault.ts`](../packages/core/src/vault.ts) (desktop and web), `VaultApi` over
OkHttp on Android (`data/vault/VaultApi.kt`). Signed URLs are cached until two minutes before
they expire.

---

## Database

The `tracks` table ([0004_vault.sql](../supabase/migrations/0004_vault.sql),
[0005_drop_drive.sql](../supabase/migrations/0005_drop_drive.sql)):

| Column | Meaning |
|---|---|
| `content_hash` | BLAKE3 of the audio — the track's identity (unique per user) |
| `storage_key` | The audio object; set only by the function's `commit` |
| `uploaded_at` | When the audio was committed |
| `artwork_key` | The full-size cover object, or null |
| `field_edited_at` | `{ field: timestamp }` — when each detail was last edited online |
| `deleted_at`, `merged_into` | Tombstones: rows are never hard-deleted, so cursor pulls see deletions |

A trigger (`tracks_protect_vault_columns`) ignores any client write to `storage_key`,
`uploaded_at`, `deleted_at` and `merged_into`; only the function and the SQL functions below set
them.

| SQL function | Does |
|---|---|
| `apply_track_edit(track, patch, edited_at)` | Field-level last-writer-wins edit (ties go to the incoming edit). Rejects read-only fields, empty titles and another user's cover key. |
| `resolve_upload_target(content_hash)` | The row an upload should attach to (same hash, live or deleted), or null for a new song. (`p_md5` is still accepted and ignored for older builds.) |
| `merge_tracks(keep, drop)` | Folds one row's favorites, ratings, playlist entries, play events and queue references into another; the dropped row becomes a merge tombstone. |
| `delete_track(track)` | Removes the track's favorites, ratings, playlist entries, play events and queue references, tombstones the row (hash kept), and returns the object keys to delete. |

Tests: [`supabase/tests/vault_smoke.sql`](../supabase/tests/vault_smoke.sql) (rolls back),
[`handler.test.ts`](../supabase/functions/vault/handler.test.ts) (`npm run vault:test`),
and the live end-to-end [`smoke.mjs`](../supabase/functions/vault/smoke.mjs).

---

## Uploading

The shared orchestration is `uploadTrack` in
[`packages/core/src/upload.ts`](../packages/core/src/upload.ts); Android mirrors it in
`data/vault/UploadManager.kt`.

1. **Prepare** the file on the device: BLAKE3 hash, tags and technical facts (duration, codec,
   sample rate, bit depth, channels, ReplayGain), the embedded cover turned into the vault's
   square JPEG + thumbnail, and (desktop, web) a same-named `.lrc` file as synced lyrics.
   - Desktop: Rust `vault/prepare.rs` (lofty, blake3, image) — files or whole folders, from the
     picker or dropped on the window.
   - Web: `lib/uploadPrepare.ts` (`music-metadata`, `hash-wasm`, canvas).
   - Android: copy to cache, BLAKE3, JAudioTagger, Bitmap — from the picker or **Share → Music Vault**.
2. **Review**: the form shows each song's details, pre-filled from its tags; batch fields and a
   shared cover apply to several songs at once. Nothing uploads until confirmed.
3. `resolve_upload_target` → if the hash is known, the upload attaches to that row (its history is
   kept; "already in your vault" when its audio is there).
4. **Cover** → `sign-put` (`art`) + PUT, full and thumbnail.
5. **Row**: a new row is inserted with the form's details; a known row is left alone for now.
6. **Audio** → `sign-put` + PUT with progress → `commit`.
7. For a known row, the form's changes are sent as a `track.edit` **after** the commit, because a
   re-uploaded deleted track is a tombstone until the commit revives it.

## Editing details and covers

"Edit details" (one track or several) sends a `track.edit` sync op per track with only the changed
fields. The server applies it with `apply_track_edit`; clients show queued edits immediately by
laying them over the synced rows. The same rule is implemented three times — SQL, TypeScript
(`applyTrackEdit`) and Kotlin (`TrackEdit.apply`) — and pinned by
[`docs/fixtures/track-edit.golden.json`](../docs/fixtures/track-edit.golden.json). A new cover is
uploaded first and then set with `artwork_key`; removing a cover sets it to null.

## Deleting

"Delete from vault" is on every client (track menu and multi-select), behind a confirmation that
says the track's ratings, favorites, playlist entries and play history go with it. The function
deletes the objects; the tombstone reaches every device through sync, and each device then drops
its cached or pinned copy (only tombstones the device has pulled count).

---

## Playing and downloading

| | Desktop | Web | Android |
|---|---|---|---|
| Library | `projectVault` over the synced rows (`lib/vaultMerge.ts`), ids `vault:<hash>` | `projectRows` (`lib/trackMap.ts`), ids = row ids | `VaultMerge` (`data/vault/VaultMerge.kt`), ids `vault:<hash>` |
| Play | `ensureVaultLocal`: cached path, else Rust downloads from a signed URL | `resolveTrackAudio`: OPFS hit, else fetch from a signed URL | `VaultDataSource`: pinned file, else signed URL through Media3's cache |
| Verify | BLAKE3 in Rust while writing | BLAKE3 (`hash-wasm`) while writing | BLAKE3 on pinned downloads |
| Cache tiers | SQLite `cache_entries` (`vault:<hash>`): auto (LRU, cap) + pinned | OPFS + IndexedDB entries (with the hash): auto + pinned | Media3 SimpleCache (auto) + Room `downloads` (pinned, `vault-<hash>.<ext>`) |
| Pin | track / album / artist / playlist "Download", Downloads → "Download all" | track / collection "Download" | track "Download" (WorkManager job, Wi-Fi/charging options) |
| Covers | fetched by key into `artwork/vault-<sha>.jpg` | cached in IndexedDB by key | `filesDir/artwork/vault-<sha>.jpg` |

A cached copy is used offline; the first play of a track needs to be online and signed in.

---

## Security

- R2 keys exist only as Supabase secrets; the API token is scoped to the one bucket. No app ever
  holds them.
- The bucket is private (no public URL, no custom domain). GET links live 1 hour, PUT links 15
  minutes, and the function signs only the caller's own keys.
- The CORS policy allows GET/PUT/HEAD from the web app's origins only.
- Rows are protected by RLS; the vault columns by the trigger above.

## Costs

R2 egress is free. Under 10 GB stored and the free operation allowance, the vault costs nothing;
past that, storage is about $0.015 per GB-month.

## Known gaps

- Replacing a track's audio with a better file while keeping its history isn't a feature yet:
  upload the new file, then delete the old one.
- Android verifies pinned downloads but not the streaming cache (Media3 caches as it plays).
- The first play of a track needs a network connection; there is no bulk "download my whole
  vault" on Android yet (desktop has "Download all").
