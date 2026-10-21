# Security policy

## Reporting a vulnerability

Please report security issues **privately**, through GitHub's
**Security → Report a vulnerability** on this repository, not in a public
issue. Include what you found, how to reproduce it, and what an attacker could
do with it. You should hear back within a week.

Only the latest commit on `main` is supported; there are no maintained release
branches.

## What is in scope

Music Vault keeps one person's music in their own Cloudflare R2 bucket and
their library in their own Supabase project. The interesting boundaries are
the ones between accounts, and between the apps and those two services:

- **The database** (`supabase/migrations/`). Every table is behind row-level
  security keyed to `auth.uid()`, and a trigger protects the columns only the
  server may set (`storage_key`, `uploaded_at`, `deleted_at`, `merged_into`).
  Reading or changing another account's rows, or writing a protected column
  from a client, is in scope.
- **The `vault` Edge Function** (`supabase/functions/vault/`). It is the only
  holder of the R2 credentials and signs short-lived upload and download URLs.
  Getting a URL for an object outside your own account's keys, deleting
  someone else's track or cover, or calling it without a valid session is in
  scope.
- **The web app** (`apps/web/`). Its proxy gates every page and API route
  behind a Supabase session. Reaching the library or the API without one is in
  scope.
- **The Windows app** (`apps/desktop/`). Anything that lets a web page, a
  track's tags or a cover image run code, read files outside the app's own
  folders, or write outside them (for example through an artwork or download
  file name) is in scope.
- **The Android app** (`apps/android/`), including files shared into it from
  other apps, and its media service: another app browsing the library or
  controlling playback without the user giving it notification access is in
  scope.

Every download is checked against the track's BLAKE3 content hash before it is
kept. A way to make a client keep audio that does not match is in scope too.

Out of scope: a deliberately weakened setup (a public bucket, row-level
security turned off, the R2 keys handed to a client), an attacker who already
has your signed-in device, and the services themselves (Supabase, Cloudflare,
Vercel).

## How it is built to be safe

See [reports/VAULT.md](reports/VAULT.md) for the vault's key layout and
signing rules, and [docs/sync-protocol.md](docs/sync-protocol.md) for what each
client may write.
