# Environment Variables

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; updated 2026-10-13 — the Google/Drive
> variables are gone and the vault's Supabase secrets are added.
> Every variable the codebase reads, found by grepping `import.meta.env`, `process.env`,
> `System.getenv`, `Deno.env`, `std::env` and the two `.env.example` files. Setup steps:
> [BUILD_AND_RUN.md](BUILD_AND_RUN.md).

## Complete inventory

| Variable | Platform | Required? | Where read |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Desktop | **Required** | [lib/supabase.ts:10](../apps/desktop/src/lib/supabase.ts) |
| `VITE_SUPABASE_ANON_KEY` | Desktop | **Required** | [lib/supabase.ts:11](../apps/desktop/src/lib/supabase.ts) |
| `RUST_LOG` | Desktop | Optional | [lib.rs](../apps/desktop/src-tauri/src/lib.rs) |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | **Required** | [proxy.ts:17](../apps/web/src/proxy.ts), `lib/supabase/{browser,server}.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web | **Required** | same |
| `E2E_EMAIL` / `E2E_PASSWORD` | Web tests | Optional | [e2e/authenticated.spec.ts](../apps/web/e2e/authenticated.spec.ts) |
| `CI` | Web tests | Set by CI | [playwright.config.ts](../apps/web/playwright.config.ts) |
| `supabase.url` / `SUPABASE_URL` | Android | **Required** | [build.gradle.kts:35](../apps/android/app/build.gradle.kts) |
| `supabase.anonKey` / `SUPABASE_ANON_KEY` | Android | **Required** | [build.gradle.kts:36](../apps/android/app/build.gradle.kts) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | `vault` Edge Function | **Required** | [functions/vault/index.ts](../supabase/functions/vault/index.ts) (Supabase secrets) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `vault` Edge Function | Injected by Supabase | same |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY`, `WEB_ORIGIN` | Vault smoke test | Optional | [functions/vault/smoke.mjs](../supabase/functions/vault/smoke.mjs) — falls back to `apps/desktop/.env` |

Since the vault there is **no local mode**: the library lives in the account, so a client built
without its Supabase values shows that no account is configured.

---

## Desktop — `apps/desktop/.env`

Template: [.env.example](../apps/desktop/.env.example). Vite exposes only `VITE_` and `TAURI_`
prefixes (`envPrefix`, [vite.config.ts](../apps/desktop/vite.config.ts)); anything else is
invisible to the frontend.

### `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- **Example**: `https://your-project-ref.supabase.co` / `eyJhbGciOi…`
- **Source**: Supabase → Settings → API.
- **Effect if unset**: `resolveSupabaseConfig` returns null and the app shows "Music Vault needs an
  account, and this build has none configured" ([AccountMenu.tsx](../apps/desktop/src/components/AccountMenu.tsx)).
- **Security**: the anon key is a *public* key designed for client distribution — RLS is what
  protects data ([DATABASE.md §1.5](DATABASE.md#15-row-level-security)). Never put the
  **service_role** key in any client; nothing in this repo reads one.

### `RUST_LOG`
- **Default**: `info,music_vault_lib=debug`.
- **Example**: `RUST_LOG=music_vault_lib=trace` for verbose engine/sync tracing.
- Output goes to `<app-data>/logs/music-vault.log` (daily rotation) **and** stderr.

---

## Web — `apps/web/.env.local`

Template: [.env.example](../apps/web/.env.example). **`NEXT_PUBLIC_` variables are inlined into the
browser bundle** — never put a secret behind that prefix.

### `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Required.** Must be the *same* Supabase project as desktop/Android — "same project as
  desktop/Android. Public — safe to expose" ([.env.example](../apps/web/.env.example)).
- **Build-time**: `next build` needs them present; CI passes dummies
  (`https://dummy-ci.supabase.co`) with the note that "a real deployment gets these from Vercel env
  settings" ([ci.yml](../.github/workflows/ci.yml)).
- **If unset at runtime**: [proxy.ts:22-25](../apps/web/src/proxy.ts) short-circuits — "Unconfigured
  deployment: let the pages render their own notice" — meaning **route protection is off**. Don't
  deploy a half-configured instance.

The web app needs nothing else: it has no server secrets, because the browser talks to R2 through
signed URLs from the `vault` function. The R2 bucket's **CORS policy** must list the web origin
instead ([docs/vault-setup.md](../docs/vault-setup.md) § 5).

### `E2E_EMAIL` / `E2E_PASSWORD`
- Credentials for a **real Supabase test account**. Authenticated specs
  `test.skip(!EMAIL || !PASSWORD, "E2E_EMAIL / E2E_PASSWORD not set")`
  ([e2e/authenticated.spec.ts:14](../apps/web/e2e/authenticated.spec.ts)), so the suite is green
  without them — see [TESTING.md](TESTING.md).
- **Security**: use a throwaway account; never a real user's.

---

## Android — `apps/android/local.properties`

**Not a `.env` file** — a Gradle properties file, git-ignored via `apps/android/local.properties`
in the root [.gitignore](../.gitignore) *and* `/local.properties` in
[apps/android/.gitignore](../apps/android/.gitignore).

```properties
supabase.url=https://YOUR-PROJECT.supabase.co
supabase.anonKey=YOUR-ANON-KEY
```

**Resolution order** — `local.properties` → environment variable → `""`:
```kotlin
fun secret(key: String, env: String): String =
    localProps.getProperty(key) ?: System.getenv(env) ?: ""
```
([build.gradle.kts:19-20](../apps/android/app/build.gradle.kts)). Values become `BuildConfig`
fields at compile time: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## Supabase Edge Function secrets — the `vault` function

Set in Supabase → Edge Functions → Secrets (or `supabase secrets set`); setup in
[docs/vault-setup.md](../docs/vault-setup.md) § 7–8.

| Secret | What |
|---|---|
| `R2_ACCOUNT_ID` | The Cloudflare account id (forms the R2 endpoint) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | An R2 API token scoped to the one bucket, Object Read & Write |
| `R2_BUCKET` | `musicvault` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform;
the function uses the service role only for the vault columns and the SQL functions the trigger
reserves for it. **Security**: ⚠️ the R2 keys are the highest-value secrets in the system — they
reach every user's audio. They exist only as Supabase secrets; no app, `.env` file or CI secret
holds them. Rotating them means a new R2 token and updating the secrets (vault-setup § "Rotating
or revoking").

---

## CI / release secrets (GitHub)

Required for usable builds — "Music Vault needs an account, so a build without them can't reach
the library" ([release.yml](../.github/workflows/release.yml)).

| Secret | Consumed by |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `windows-installer` job |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `android-apk` job |

⚠️ **These are baked into the published artifacts.** Anyone with the installer or APK can extract
them. That is acceptable for the anon key (public by design, RLS-protected), but it means
published builds tie every user to *your* Supabase project. It is not a way to ship a secret.

---

## Security summary

| Value | Exposure | Verdict |
|---|---|---|
| Supabase **anon key** | Public — in every bundle | ✅ By design; RLS is the control |
| Supabase **service_role key** | Inside the `vault` function only (platform-injected) | ✅ Never in a client, file or CI secret |
| **R2 keys** | Supabase secrets only | ⚠️ Real secret — reaches every user's audio; token scoped to one bucket |
| `E2E_PASSWORD` | CI only | ⚠️ Use a throwaway account |

The `.gitignore` blanket-ignores `.env` and `.env.*` while un-ignoring `!.env.example`, and ignores
`apps/android/local.properties` — no credential file is tracked. Verified: `git ls-files` returns
only the two `.env.example` templates.
