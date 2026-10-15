import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * E2E config. Two tiers of tests live in e2e/:
 *  - unauthenticated smoke tests (always run; work against dummy Supabase env)
 *  - authenticated flows (auth/browse/playlist) that sign in with a real test
 *    account — they run only when E2E_EMAIL/E2E_PASSWORD are set and skip
 *    themselves otherwise.
 *
 * Local runs pick up real Supabase creds from .env.local (loaded by Next).
 * CI has no .env.local, so dummy values are injected to let the app boot.
 */
const hasEnvLocal = existsSync(join(__dirname, ".env.local"));
const dummySupabaseEnv: Record<string, string> =
  hasEnvLocal || process.env.NEXT_PUBLIC_SUPABASE_URL
    ? {}
    : {
        NEXT_PUBLIC_SUPABASE_URL: "https://dummy-e2e.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key-for-e2e",
      };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // authenticated specs share one account — keep them serial
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...dummySupabaseEnv },
  },
});
