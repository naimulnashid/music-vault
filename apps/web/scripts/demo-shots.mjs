/**
 * README screenshots from invented data:  npm run demo:shots -w music-vault-web
 *
 * 1. Builds the demo: the web app with the made-up library in src/lib/demo.ts
 *    instead of an account (demo-server.mjs).
 * 2. Starts that build on port 3300, captures each page in the dark and the
 *    light theme with Playwright, and stops the server it started.
 * 3. Writes WebP files to docs/screenshots/ at the repo root.
 *
 * Nothing here can show a real library: the demo build has no account to
 * reach. Chromium comes from Playwright's own download (`npx playwright
 * install chromium`); set MV_SHOTS_BROWSER to use another Chromium build.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { BASE, buildDemo, startDemo, WEB } from "./demo-server.mjs";

const OUT = resolve(WEB, "..", "..", "docs", "screenshots");

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

buildDemo();
const stop = await startDemo();
try {
  const browser = await chromium.launch({ executablePath: process.env.MV_SHOTS_BROWSER || undefined });
  try {
    await capture(browser);
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
