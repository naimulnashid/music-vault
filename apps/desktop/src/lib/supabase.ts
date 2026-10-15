import { createMusicVaultClient, resolveSupabaseConfig, type MusicVaultClient } from "@musicvault/core";

/**
 * The Supabase client for this install, or null when the env vars are unset —
 * a build without an account configured, which can't reach the vault.
 * Configure via apps/desktop/.env (see .env.example).
 */
export const supabase: MusicVaultClient | null = (() => {
  const config = resolveSupabaseConfig(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  return config ? createMusicVaultClient(config) : null;
})();
