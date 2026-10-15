import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type MusicVaultClient = SupabaseClient<Database>;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Returns the config when both env values are present, else null. The library
 * lives in the account, so clients treat null as "this build has no account
 * configured" and say so instead of running.
 */
export function resolveSupabaseConfig(url: string | undefined, anonKey: string | undefined): SupabaseConfig | null {
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function createMusicVaultClient(config: SupabaseConfig): MusicVaultClient {
  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
