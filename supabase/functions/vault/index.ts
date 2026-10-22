// Supabase Edge Function "vault": hands out short-lived pre-signed R2 URLs so
// the apps never hold R2 credentials. Deploy with JWT verification on.
// Secrets (Edge Functions → Secrets): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.3";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import { type Caller, createHandler, type ObjectStore, type TrackRow, type UserDb } from "./handler.ts";

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const R2_ENDPOINT = `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}`;

const aws = new AwsClient({
  accessKeyId: env("R2_ACCESS_KEY_ID"),
  secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  service: "s3",
  region: "auto",
});

const objectUrl = (key: string) => `${R2_ENDPOINT}/${key}`;

const store: ObjectStore = {
  async presign(method, key, ttlSeconds) {
    const url = new URL(objectUrl(key));
    url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
    const signed = await aws.sign(new Request(url, { method }), { aws: { signQuery: true } });
    return signed.url;
  },
  async size(key) {
    const res = await aws.fetch(objectUrl(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
    return Number(res.headers.get("content-length") ?? "0");
  },
  async remove(key) {
    const res = await aws.fetch(objectUrl(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
  },
};

const noSession = { persistSession: false, autoRefreshToken: false };
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: noSession });

// PostgREST takes `in` filters in the query string; chunk to keep URLs short.
const IN_CHUNK = 25;

async function referenced(client: SupabaseClient, column: "storage_key", keys: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const { data, error } = await client
      .from("tracks")
      .select(column)
      .in(column, keys.slice(i, i + IN_CHUNK))
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data as Record<string, string>[]) found.add(row[column]);
  }
  return found;
}

function userDb(client: SupabaseClient): UserDb {
  return {
    async getTrack(id) {
      const { data, error } = await client
        .from("tracks")
        .select("id, content_hash, file_size")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as TrackRow | null;
    },
    referencedStorageKeys: (keys) => referenced(client, "storage_key", keys),
    async referencedArtworkKeys(keys) {
      // Song covers and artist photos (migration 0008); one RPC, keys in the body.
      const { data, error } = await client.rpc("referenced_artwork_keys", { p_keys: keys });
      if (error) throw error;
      return new Set(data as string[]);
    },
    async deleteTrack(id) {
      const { data, error } = await client.rpc("delete_track", { p_track_id: id });
      if (error) {
        if (error.code === "P0002") return null;
        throw error;
      }
      const row = (data as { storage_key: string | null; artwork_key: string | null; artwork_still_used: boolean }[])[0];
      return {
        storageKey: row?.storage_key ?? null,
        artworkKey: row?.artwork_key ?? null,
        artworkStillUsed: Boolean(row?.artwork_still_used),
      };
    },
  };
}

async function authenticate(req: Request): Promise<Caller | null> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: noSession,
  });
  const { data, error } = await client.auth.getUser(authorization.slice("Bearer ".length));
  if (error || !data.user) return null;
  return { userId: data.user.id, db: userDb(client) };
}

Deno.serve(
  createHandler({
    authenticate,
    store,
    admin: {
      async markStored(trackId, storageKey) {
        const { error } = await admin
          .from("tracks")
          .update({ storage_key: storageKey, uploaded_at: new Date().toISOString(), deleted_at: null })
          .eq("id", trackId);
        if (error) throw error;
      },
    },
  }),
);
