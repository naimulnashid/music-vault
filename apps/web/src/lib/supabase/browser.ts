import { createBrowserClient } from "@supabase/ssr";
import type { Database, MusicVaultClient } from "@musicvault/core";

/**
 * Cookie-based Supabase client for client components. Unlike desktop's
 * localStorage session, @supabase/ssr keeps the session in cookies so the
 * proxy and server components see the same auth state.
 *
 * Null when the NEXT_PUBLIC_SUPABASE_* env vars are unset — the app renders a
 * "not configured" notice instead of crashing, as desktop does.
 */
let client: MusicVaultClient | null | undefined;

export function getSupabaseBrowser(): MusicVaultClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && anonKey ? createBrowserClient<Database>(url, anonKey) : null;
  return client;
}
