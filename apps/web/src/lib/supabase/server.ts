import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database, MusicVaultClient } from "@musicvault/core";

/**
 * Per-request Supabase client for server components and route handlers.
 * Returns null when the env vars are unset (unconfigured deployment).
 */
export async function getSupabaseServer(): Promise<MusicVaultClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — safe to ignore, the proxy
          // refreshes sessions before requests reach this point.
        }
      },
    },
  });
}
