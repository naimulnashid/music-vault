# Supabase setup (one-time)

MusicVault uses Supabase for the account, the library (every track's details,
playlists, favorites, history) and cross-device sync. The apps need it.

## 1. Create the project

1. Go to <https://supabase.com/dashboard> → **New project** (free tier is fine).
2. Name it e.g. `music-vault`, pick a strong database password (store it — it
   is not needed by the apps, only for admin access), choose a region near you.

## 2. Apply the schema

1. Dashboard → **SQL Editor** → paste and **Run** each migration in order:
   1. [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
   2. [`supabase/migrations/0002_track_identity_upsert.sql`](../supabase/migrations/0002_track_identity_upsert.sql)
   3. [`supabase/migrations/0003_sync.sql`](../supabase/migrations/0003_sync.sql) — sync engine
      (edited_at LWW columns, soft deletes, Realtime publication)
   4. [`supabase/migrations/0004_vault.sql`](../supabase/migrations/0004_vault.sql) — the vault
      (storage keys, online-edited details, tombstones, `apply_track_edit`, `resolve_upload_target`,
      `merge_tracks`, `delete_track`)
   5. [`supabase/migrations/0005_drop_drive.sql`](../supabase/migrations/0005_drop_drive.sql) — tracks
      are identified by content hash only
2. Optional sanity checks — each rolls itself back:
   [`supabase/tests/rls_smoke.sql`](../supabase/tests/rls_smoke.sql) must end with
   `RLS smoke test passed`, [`supabase/tests/vault_smoke.sql`](../supabase/tests/vault_smoke.sql)
   with `Vault smoke test passed`.

   (Alternative: `supabase db push` with the Supabase CLI if you prefer
   migrations from the command line.)

## 3. Get the API credentials

Dashboard → **Settings → API**:

- **Project URL** — e.g. `https://abcd1234.supabase.co`
- **anon public key** — the long JWT under "Project API keys"

The anon key is safe to embed in clients; RLS enforces per-user access.

## 4. Configure the clients

**Desktop** — create `apps/desktop/.env` (see `.env.example`):

```
VITE_SUPABASE_URL=https://abcd1234.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Android** — add to `apps/android/local.properties` (never committed):

```
supabase.url=https://abcd1234.supabase.co
supabase.anonKey=eyJ...
```

**Web** — Vercel env vars `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## 5. Auth settings (recommended)

Dashboard → **Authentication → Providers → Email**:

- Keep **Confirm email** on (default). The apps handle the “confirm then sign
  in” flow.
- Under **Authentication → URL Configuration**, set the Site URL to your web
  app's address so confirmation emails link back to it.

## 6. Verify

Start the desktop app (`npm run desktop:dev`) — the account menu should offer
**Sign in** (it says "No account" when the env vars are missing). Create an
account, confirm the email, sign in on desktop and Android, then check
Dashboard → **Table Editor → devices**: one row per signed-in install.

Next: the vault — [vault-setup.md](vault-setup.md).
