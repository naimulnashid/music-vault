// End-to-end check of the deployed `vault` function against the real R2
// bucket (migration step M1). Run it yourself — it signs in as you:
//
//   node supabase/functions/vault/smoke.mjs
//
// It creates one temporary track row ("Vault smoke test (temporary)") with
// 64 KiB of random bytes, exercises upload → commit → download → covers →
// edits → delete, and removes everything again. Close the web app while it
// runs so it never picks up the temporary row.
//
// Supabase URL + anon key come from apps/desktop/.env (or SUPABASE_URL /
// SUPABASE_ANON_KEY). Your password is read from a hidden prompt and never
// stored.

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import readline from "node:readline";

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY };
  }
  const text = readFileSync(new URL("../../../apps/desktop/.env", import.meta.url), "utf8");
  const env = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  return { url: env.VITE_SUPABASE_URL, anon: env.VITE_SUPABASE_ANON_KEY };
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function main() {
  const { url, anon } = loadEnv();
  if (!url || !anon) throw new Error("Supabase URL / anon key not found (apps/desktop/.env)");

  const email = await ask("MusicVault email: ");
  const password = await ask("Password (hidden): ", true);
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`Sign-in failed: ${authError.message}`);
  const userId = auth.user.id;
  const token = auth.session.access_token;
  console.log(`\nSigned in. Running vault checks…\n`);

  const vault = async (body) => {
    const res = await fetch(`${url}/functions/v1/vault`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const audio = randomBytes(64 * 1024);
  const hash = sha256(audio); // stands in for BLAKE3 — the function only needs 64 hex chars
  let trackId = null;

  try {
    // 1. Row + protected columns
    const { data: row, error: insertError } = await supabase
      .from("tracks")
      .insert({
        user_id: userId,
        content_hash: hash,
        file_name: "vault-smoke-test.flac",
        file_size: audio.length,
        title: "Vault smoke test (temporary)",
        storage_key: "users/forged/audio/x.flac",
      })
      .select("id, storage_key")
      .single();
    if (insertError) throw new Error(`Could not create the temporary row: ${insertError.message}`);
    trackId = row.id;
    check("a client cannot set storage_key itself", row.storage_key === null);

    // 2. Upload
    const put = await vault({ action: "sign-put", kind: "audio", trackId, ext: "flac" });
    check("sign-put returns an upload URL", put.status === 200 && put.body?.url, JSON.stringify(put.body));
    const key = put.body?.key;
    check("the key is under your own prefix", key === `users/${userId}/audio/${hash}.flac`, key);
    const upload = await fetch(put.body.url, { method: "PUT", body: audio });
    check("R2 accepts the upload", upload.ok, `HTTP ${upload.status} ${await upload.text().catch(() => "")}`);

    // 3. Commit
    const wrongExt = await vault({ action: "commit", trackId, ext: "mp3" });
    check("commit refuses an object that was never uploaded", wrongExt.body?.error === "not_uploaded");
    const commit = await vault({ action: "commit", trackId, ext: "flac" });
    check("commit confirms the upload", commit.status === 200 && commit.body?.storageKey === key, JSON.stringify(commit.body));
    const { data: stored } = await supabase.from("tracks").select("storage_key, uploaded_at").eq("id", trackId).single();
    check("the row now records where the audio lives", stored?.storage_key === key && stored?.uploaded_at);

    // 4. Download
    const get = await vault({ action: "sign-get", keys: [key] });
    const getUrl = get.body?.urls?.[key];
    check("sign-get signs your own audio", Boolean(getUrl), JSON.stringify(get.body));
    const download = await fetch(getUrl);
    const bytes = Buffer.from(await download.arrayBuffer());
    check("the downloaded bytes match the upload", download.ok && bytes.equals(audio));
    const range = await fetch(getUrl, { headers: { Range: "bytes=0-99" } });
    check("range requests work (seeking)", range.status === 206 && (await range.arrayBuffer()).byteLength === 100);

    // 5. Isolation
    const foreign = `users/00000000-0000-4000-8000-000000000000/audio/${hash}.flac`;
    const denied = await vault({ action: "sign-get", keys: [foreign] });
    check("another user's key is refused", denied.body?.denied?.includes(foreign) && !denied.body?.urls?.[foreign]);

    // 6. CORS for the web app
    const preflight = await fetch(getUrl, {
      method: "OPTIONS",
      headers: { Origin: WEB_ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    check(
      `the bucket's CORS policy allows ${WEB_ORIGIN}`,
      preflight.headers.get("access-control-allow-origin") === WEB_ORIGIN || preflight.headers.get("access-control-allow-origin") === "*",
      `HTTP ${preflight.status}, allow-origin: ${preflight.headers.get("access-control-allow-origin")}`,
    );

    // 7. Cover upload + edit
    const art = randomBytes(2048);
    const artSha = sha256(art);
    const artPut = await vault({ action: "sign-put", kind: "art", sha256: artSha, variant: "full", size: art.length });
    const artUpload = artPut.body?.url ? await fetch(artPut.body.url, { method: "PUT", body: art }) : null;
    check("a cover uploads", artUpload?.ok === true, JSON.stringify(artPut.body));
    const { error: artEditError } = await supabase.rpc("apply_track_edit", {
      p_track_id: trackId,
      p_patch: { artwork_key: artPut.body?.key },
      p_edited_at: new Date().toISOString(),
    });
    check("the cover is attached with an edit", !artEditError, artEditError?.message);
    const artGet = await vault({ action: "sign-get", keys: [artPut.body?.key] });
    const artUrl = artGet.body?.urls?.[artPut.body?.key];
    const artBytes = artUrl ? Buffer.from(await (await fetch(artUrl)).arrayBuffer()) : Buffer.alloc(0);
    check("the cover downloads intact", artBytes.equals(art));

    // 8. Field-level last-writer-wins
    const newer = new Date(Date.now() + 1000).toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();
    await supabase.rpc("apply_track_edit", { p_track_id: trackId, p_patch: { title: "Newer title" }, p_edited_at: newer });
    await supabase.rpc("apply_track_edit", {
      p_track_id: trackId,
      p_patch: { title: "Older title", language: "Smoke" },
      p_edited_at: older,
    });
    const { data: edited } = await supabase.from("tracks").select("title, language").eq("id", trackId).single();
    check("an older edit doesn't overwrite a newer one", edited?.title === "Newer title", edited?.title);
    check("an edit to a different field still applies", edited?.language === "Smoke", edited?.language);
    const { error: readOnlyError } = await supabase.rpc("apply_track_edit", {
      p_track_id: trackId,
      p_patch: { duration: 1 },
      p_edited_at: newer,
    });
    check("read-only fields are refused", Boolean(readOnlyError));

    // 9. Delete
    const del = await vault({ action: "delete", trackId });
    check("delete succeeds", del.status === 200 && del.body?.deleted === true, JSON.stringify(del.body));
    const { data: tomb } = await supabase.from("tracks").select("deleted_at, storage_key").eq("id", trackId).single();
    check("the row becomes a tombstone", tomb?.deleted_at && tomb?.storage_key === null);
    const gone = await fetch(getUrl);
    check("the audio object is gone from R2", gone.status === 404, `HTTP ${gone.status}`);
    const artGone = artUrl ? await fetch(artUrl) : null;
    check("the unshared cover is gone from R2", artGone?.status === 404, `HTTP ${artGone?.status}`);
    const after = await vault({ action: "sign-get", keys: [key] });
    check("a deleted track's audio can't be signed again", after.body?.denied?.includes(key));
  } finally {
    if (trackId) {
      // The function already deleted the objects; drop the temporary row entirely.
      await vault({ action: "delete", trackId }).catch(() => {});
      const { error } = await supabase.from("tracks").delete().eq("id", trackId);
      if (error) console.log(`\n  ! Could not remove the temporary row ${trackId}: ${error.message}`);
    }
    // "local": end only this script's session. The default ("global") would
    // revoke every device's sign-in (desktop, web, Android) along with it.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  }

  console.log(failures === 0 ? "\nAll vault checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`\nSmoke test aborted: ${e.message}`);
  process.exitCode = 1;
});
