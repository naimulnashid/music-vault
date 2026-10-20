/**
 * The demo build shared by demo-shots.mjs (README screenshots) and
 * demo-video.mjs (the demo video's app footage).
 *
 * buildDemo() builds the web app with NEXT_PUBLIC_MV_DEMO=1 and no Supabase
 * settings into .next-demo/ (the real .next build is untouched), so the app
 * loads the made-up library in src/lib/demo.ts instead of an account.
 * startDemo() serves that build with `next start` (never `next dev`) on
 * 127.0.0.1:3300 and returns a function that stops only the server it started.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3300;
export const BASE = `http://127.0.0.1:${PORT}`;
const env = {
  ...process.env,
  NEXT_PUBLIC_MV_DEMO: "1",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_DIST_DIR: ".next-demo",
};
// Next's own entry run through this Node: no shell, so paths with spaces are fine.
const nextJs = createRequire(import.meta.url).resolve("next/dist/bin/next");

// A build in another distDir rewrites these two to point at it; put them back.
const KEEP = ["next-env.d.ts", "tsconfig.json"].map((f) => join(WEB, f));

export function buildDemo() {
  const saved = KEEP.map((f) => readFileSync(f));
  try {
    const r = spawnSync(process.execPath, [nextJs, "build"], { cwd: WEB, env, stdio: "inherit" });
    if (r.status !== 0) throw new Error("next build failed");
  } finally {
    KEEP.forEach((f, i) => writeFileSync(f, saved[i]));
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("demo server did not start");
}

export async function startDemo() {
  const server = spawn(process.execPath, [nextJs, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: WEB,
    env,
    stdio: "ignore",
  });
  const stop = () => {
    // Only the server this script started.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill();
  };
  try {
    await waitForServer();
  } catch (e) {
    stop();
    throw e;
  }
  return stop;
}
