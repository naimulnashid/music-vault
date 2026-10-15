/**
 * README screenshots from invented data:  npm run demo:shots -w music-vault-web
 *
 * 1. Builds the web app with NEXT_PUBLIC_MV_DEMO=1 and no Supabase settings
 *    into .next-demo/ (the real .next build is untouched), so the app loads the
 *    made-up library in src/lib/demo.ts instead of an account.
 * 2. Starts that build on port 3300, captures each page in the dark and the
 *    light theme with Playwright, and stops the server it started.
 * 3. Writes WebP files to docs/screenshots/ at the repo root.
 *
 * Nothing here can show a real library: the demo build has no account to
 * reach. Chromium comes from Playwright's own download (`npx playwright
 * install chromium`); set MV_SHOTS_BROWSER to use another Chromium build.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(WEB, "..", "..", "docs", "screenshots");
const PORT = 3300;
const BASE = `http://127.0.0.1:${PORT}`;
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

function run(args) {
  const saved = KEEP.map((f) => readFileSync(f));
  try {
    const r = spawnSync(process.execPath, [nextJs, ...args], { cwd: WEB, env, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`next ${args.join(" ")} failed`);
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

const SHOTS = [
  { name: "library", path: "/", wait: "main h1" },
  { name: "album", path: "/albums", click: "main >> text=Saltwater Hours", wait: "main h1" },
  { name: "now-playing", path: "/", openPlayer: true },
  { name: "statistics", path: "/stats", wait: "text=Last 6 Months", height: 1240 },
  { name: "downloads", path: "/downloads", wait: "main h1" },
];

async function capture(browser) {
  mkdirSync(OUT, { recursive: true });
  // The Android shots (android-*.webp) come from apps/android/scripts/demo-shots.mjs.
  for (const f of readdirSync(OUT)) if (f.endsWith(".webp") && !f.startsWith("android-")) rmSync(join(OUT, f));
  // One page for every shot: the demo loads once (the first visit may also run
  // the one-time fresh start and reload), then views change in the app.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const bar = page.locator("div.backdrop-blur-2xl.border-t").first();
  await bar.locator("text=Saltwater Hours").first().waitFor({ timeout: 120_000 });
  const go = (path) =>
    page.evaluate((p) => {
      window.history.pushState(null, "", p);
      window.dispatchEvent(new PopStateEvent("popstate", { state: { mvIndex: 1 } }));
    }, path);

  // The theme is a setting the app re-applies, so switch it the way a user does.
  const setTheme = async (label) => {
    await page.click('button[title="you@example.com"]');
    await page.click(`button:has-text("${label}")`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  };
  const title = bar.locator("text=Saltwater Hours").first();

  for (const theme of ["dark", "light"]) {
    await setTheme(theme === "dark" ? "Dark" : "Light");
    for (const shot of SHOTS) {
      await page.setViewportSize({ width: 1440, height: shot.height ?? 900 });
      await go(shot.path);
      if (shot.click) await page.click(shot.click);
      if (shot.wait) await page.waitForSelector(shot.wait);
      // A click on the bar outside its controls opens the full player.
      if (shot.openPlayer) await title.click();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(1500);
      const png = await page.screenshot();
      const file = join(OUT, theme === "dark" ? `${shot.name}.webp` : `${shot.name}-light.webp`);
      await sharp(png).webp({ quality: 82 }).toFile(file);
      console.log("wrote", file);
      if (shot.openPlayer) {
        await title.click();
        await page.waitForTimeout(600);
      }
    }
  }
  await context.close();
}

run(["build"]);
const server = spawn(process.execPath, [nextJs, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  cwd: WEB,
  env,
  stdio: "ignore",
});
try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: process.env.MV_SHOTS_BROWSER || undefined });
  try {
    await capture(browser);
  } finally {
    await browser.close();
  }
} finally {
  // Only the server this script started.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}
