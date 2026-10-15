# Vault setup — Cloudflare R2 + Supabase secrets

The vault is where Music Vault keeps your audio and covers: one private Cloudflare R2 bucket,
reached only through the `vault` Edge Function. You set it up once, by hand, in two web
dashboards. It takes about 15 minutes, plus deploying the function (below).

**Rules for the keys:** the R2 Access Key ID and Secret Access Key go **only** into Supabase's
secret store (step 8) and your password manager. Never paste them into a chat, an issue, a `.env`
file that's committed, or a terminal command that ends up in shell history. The apps never see
them.

---

## 1. Create a Cloudflare account
1. Go to <https://dash.cloudflare.com/sign-up> and sign up. Verify your email.
2. You do **not** need to add a website or domain. Skip any "add a site" prompt.

## 2. Enable R2
1. In the dashboard sidebar, open **R2 Object Storage** (under *Storage & databases* in newer
   layouts).
2. Follow the prompt to enable R2. Cloudflare asks for a payment method even for the free tier.
   Under 10 GB stored you are not charged: downloads are free, and your usage stays far below the
   free operation limits.

## 3. Create the bucket
1. **R2 Object Storage → Create bucket.**
2. **Name:** `musicvault`
3. **Location:** *Automatic*, or a location hint of **Asia-Pacific (APAC)** to keep data near you.
   Do **not** choose a jurisdiction (EU / FedRAMP): those use a different endpoint.
4. **Default storage class:** **Standard**. *Not* Infrequent Access, which charges for every
   read.
5. **Create bucket.**

## 4. Confirm the bucket is private
Open the bucket, then **Settings**:
- **Public Development URL (r2.dev):** must be **Disabled**, which is the default.
- **Custom Domains:** leave empty.

Audio is only ever reached through short-lived signed links from the `vault` function.

## 5. Add the CORS policy (for the web app)
Desktop and Android don't need this. Browsers do.

Bucket → **Settings → CORS Policy → Add CORS policy** → **JSON** tab, paste, **Save**:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

When the web app is deployed, add its address to `AllowedOrigins`, for example
`"https://your-app.vercel.app"`. Use the exact origin: no trailing slash and no path. Changes can
take up to 30 seconds to apply.

## 6. Note your Account ID
On the **R2 Object Storage** overview page, copy your **Account ID** (a 32-character hex string).
It is not secret, but you will need it in step 8.

## 7. Create the API token
1. **R2 Object Storage** overview → **Manage API tokens** (shown as *API Tokens → Manage* in some
   layouts) → **Create Account API token**.
2. **Token name:** `musicvault-vault-function`
3. **Permissions:** **Object Read & Write**.
4. **Specify bucket(s):** **Apply to specific buckets only** → select `musicvault`.
5. **TTL:** *Forever* is simplest for a personal project. If you set an expiry, you'll need to
   repeat steps 7–8 when it lapses.
6. **Client IP Address Filtering:** leave empty. Supabase's servers don't have fixed addresses.
7. **Create API Token.**
8. On the confirmation page, copy **Access Key ID** and **Secret Access Key** into your password
   manager **now**. The secret is shown only once. You do **not** need the "Token value" shown on
   the same page; that's for Cloudflare's own API.

The page also shows an S3 endpoint, `https://<account-id>.r2.cloudflarestorage.com`. It just
confirms the Account ID from step 6.

## 8. Store the secrets in Supabase
1. Open <https://supabase.com/dashboard> → your MusicVault project → **Edge Functions →
   Secrets**.
2. Add these four, then **Save**:

| Name | Value |
|---|---|
| `R2_ACCOUNT_ID` | Account ID from step 6 |
| `R2_ACCESS_KEY_ID` | Access Key ID from step 7 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key from step 7 |
| `R2_BUCKET` | `musicvault` |

Names are case-sensitive and must not start with `SUPABASE_`. Changing secrets needs the Owner or
Administrator role on the project.

## 9. Optional: a usage alert
Cloudflare dashboard → **Notifications → Add** → choose the usage-based billing alert if your
account offers it. Set it low (for example $1) so any unexpected charge is flagged early.

---

## Done when
- The Supabase **Secrets** page lists the four names above. You can't read the values back there,
  which is expected.
- The `musicvault` bucket exists, is private, and has the CORS policy.

Then set up the server side below; its end-to-end check tests the function against this bucket
without anyone handling the keys.

---

## Server side: database and function

### Database
Apply the migrations through [`0005_drop_drive.sql`](../supabase/migrations/0005_drop_drive.sql)
([setup-supabase.md](setup-supabase.md) § 2; SQL editor, or `supabase db push`). Then run [`supabase/tests/vault_smoke.sql`](../supabase/tests/vault_smoke.sql)
in the SQL editor. It ends with `Vault smoke test passed` and rolls everything back.

### The `vault` Edge Function
Source: [`supabase/functions/vault/`](../supabase/functions/vault/). Deploy it with **JWT
verification on**:

```bash
supabase functions deploy vault --project-ref <project-ref>
```

(The first deployment was done through the Supabase MCP connector, which uploads the same three
files: `index.ts`, `handler.ts` and `keys.ts`.) It reads the four `R2_*` secrets from step 8. If
one is missing, the function fails to start and every call returns 5xx.

Unit tests (no network): `npm run vault:typecheck && npm run vault:test`. Both also run in CI.

### End-to-end check (you run it)
With the **web app closed**, so it doesn't pick up the temporary row:

```bash
node supabase/functions/vault/smoke.mjs
```

It asks for your MusicVault email and password (hidden, never stored). It then creates one
temporary track with random bytes and checks: upload, commit, download, range requests,
refusal of another user's key, the bucket's CORS policy for `http://localhost:3000` (set
`WEB_ORIGIN` to check another origin), cover upload, field-level edits, and delete. Finally it
removes the temporary row. Expected last line: `All vault checks passed.`

### Rotating or revoking
If a key may have leaked, delete the token in **Manage API tokens**, create a new one (step 7),
and replace the two key secrets in Supabase (step 8). Nothing else changes.
