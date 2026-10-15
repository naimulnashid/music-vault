# Web App Setup (apps/web)

The web app is a Next.js 16 App Router project. It reuses `@musicvault/core`
(types, smart rules, the sync engine, the vault client and upload model) and
mirrors the desktop app's architecture with browser storage:

| Desktop | Web |
|---|---|
| SQLite (sync outbox/cursors/shadow) | IndexedDB `mv-sync` |
| `%APPDATA%` audio-cache + downloads | OPFS `/audio` (two tiers, LRU + pinned) |
| Rust upload preparation (tags, BLAKE3, covers) | `music-metadata` + `hash-wasm` + canvas, in the browser |
| Rust audio engine | dual-`<audio>` Web Audio graph (gapless, crossfade, EQ) |

The library itself is **the synced Supabase index**: every `tracks` row with
audio in the vault becomes a library entry, with its details as stored online.
Songs are added with **Upload** (file picker or drag-and-drop); the browser
hashes them and sends the bytes straight to R2 through pre-signed links.

## 1. Environment variables

Copy `apps/web/.env.example` to `apps/web/.env.local`:

| Variable | What |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project as desktop/Android |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Its anon key |

That's all: the vault's R2 keys live only in Supabase secrets, used by the
`vault` Edge Function ([vault-setup.md](vault-setup.md)). Supabase project
setup (migrations 0001–0005) is shared with desktop — see
[setup-supabase.md](setup-supabase.md).

The R2 bucket's CORS policy must allow the web app's origin (both
`http://localhost:3000` and the deployed URL) for GET and PUT —
[vault-setup.md](vault-setup.md) § 5.

## 2. Run locally

```sh
npm install
npm run web:dev      # http://localhost:3000
```

Sign in with the same Music Vault account as desktop. The sync engine pulls
the whole library on first sign-in; afterwards the app opens instantly from
IndexedDB and works offline (edits queue in the persisted outbox).

If the project folder was moved or renamed, delete `apps/web/.next` before
starting the dev server: a build cache from the old location makes `next dev`
spawn workers endlessly.

## 3. Deploy to Vercel

1. Import the GitHub repo into Vercel.
2. **Root Directory**: `apps/web` (leave "Include files outside root" ON — the
   build needs `packages/core` from the monorepo).
3. Framework preset: Next.js (auto-detected). Install command `npm install`
   runs at the repo root automatically for npm workspaces.
4. Add the two env vars from §1.
5. In Supabase → Authentication → URL Configuration, add the Vercel domain to
   the allowed redirect URLs (email confirmation links), and add it to the R2
   bucket's CORS policy.

## Storage & behavior notes

- **Two-tier audio cache**: playing a track downloads it once into the OPFS
  auto-cache (LRU, default cap 4 GB, adjustable in the Downloads view);
  explicit Download actions pin tracks permanently. Nothing streams twice.
  Every download is checked against the track's BLAKE3 hash.
- Clearing the browser's site data wipes the sync state (safe — it re-pulls)
  and all downloaded audio (re-downloadable).
- **Covers** are the online covers (`artwork_key`), cached in IndexedDB; add or
  replace one with "Edit details".
- A track deleted from the vault on any device disappears here too, and its
  downloaded copy is removed.
- OPFS requires a modern browser (Chrome/Edge 102+, Firefox 111+, Safari 15.2+).
