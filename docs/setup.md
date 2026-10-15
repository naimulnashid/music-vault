# Setting up Music Vault — from zero to all three apps

The one-page map. Each step links to the detailed guide; do them in order.
Music Vault needs an account: the library lives in Supabase and the audio in
your private R2 vault, so steps 1–3 are required before the apps are useful.

## 1. Build & run

Prerequisites: Node 20+, Rust stable (MSVC) + WebView2 for desktop,
JDK 17 + Android SDK for Android.

```sh
npm install                                   # all JS workspaces
npm run desktop:dev                           # desktop (hot reload)
npm run web:dev                               # web on http://localhost:3000
cd apps/android && ./gradlew.bat assembleDebug  # Android APK
```

## 2. Supabase (account, library, sync) — [setup-supabase.md](setup-supabase.md)

Create a free project, run the SQL migrations, then hand the Project URL +
anon key to each app:

| App | Where |
|---|---|
| Desktop | `apps/desktop/.env` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Web | `apps/web/.env.local` → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Android | `apps/android/local.properties` → `supabase.url`, `supabase.anonKey` |

## 3. The vault (audio and covers) — [vault-setup.md](vault-setup.md)

One private Cloudflare R2 bucket, an API token scoped to it, a CORS policy for
the web app, and the token stored as Supabase secrets. Then deploy the `vault`
Edge Function. The apps never see the R2 keys — they ask the function for
short-lived signed links.

## 4. Deploy the web app — [web-setup.md](web-setup.md)

Import the repo into Vercel with **root directory `apps/web`**, set the two
Supabase env vars from step 2 in the Vercel dashboard, deploy. Vercel builds
preview deployments for every push/PR automatically once the repo is linked —
no GitHub Actions needed for that.

## 5. CI & release builds

GitHub Actions run on every push/PR to `main` (`.github/workflows/ci.yml`):
core/web/desktop lint + typecheck + tests, Playwright web smoke e2e, Rust
`cargo test` (Windows), Android unit tests.

Installers (`.github/workflows/release.yml`) build when you run the workflow
by hand: the Windows NSIS installer and the Android debug APK, uploaded as
run artifacts, and attached to the tag's release when you run it on a tag.
A signed Android release APK needs your own key, so it is built locally
(see [apps/android/README.md](../apps/android/README.md#release-apk)). Repository
secrets bake the account settings into the binaries (a build without them
can't reach the library):

| Secret | Used by |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Windows installer |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | APK |

Because every build carries the project it was built for, the public
`naimulnashid/music-vault` repository is source only: its releases have no
binaries, and `release.yml` skips itself there. In a fork, add the secrets
above for your own Supabase project and the workflow builds your installers.

Authenticated web e2e flows (sign-in/browse/playlists) run when
`E2E_EMAIL`/`E2E_PASSWORD` are set (locally or as CI secrets) against a
dedicated throwaway account; they skip otherwise.

## Where things live at runtime

| | Desktop | Web | Android |
|---|---|---|---|
| Library DB | `%APPDATA%/com.musicvault.app/library.db` | IndexedDB | Room |
| Audio cache / downloads | `audio-cache/` + `downloads/` in appdata | OPFS `/audio` | Media3 cache + `filesDir/downloads` |
| Covers | `artwork/` in appdata | IndexedDB | `filesDir/artwork` |
| Logs | `logs/` in appdata (daily rotation, sync breadcrumbs included) | browser console | logcat (`MVSync` for sync) |

User-facing docs (what the apps do, not how to build them): the web app's
[/help page](../apps/web/src/app/help/page.tsx), served publicly at `<site>/help`.
