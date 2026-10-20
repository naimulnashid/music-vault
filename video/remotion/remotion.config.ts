import { Config } from "@remotion/cli/config";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Reuse Playwright's headless Chromium (already used by the other video scripts)
// so Remotion doesn't download its own copy. Elsewhere it falls back to its own.
function playwrightShell(): string | null {
  const root = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ms-playwright");
  if (!root || !existsSync(root)) return null;
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort()
    .reverse();
  for (const d of dirs) {
    const exe = join(root, d, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}

Config.setBrowserExecutable(playwrightShell());
// Near-lossless: these clips are re-encoded once more when the cuts are assembled.
Config.setVideoImageFormat("png");
Config.setCrf(12);
Config.setPixelFormat("yuv420p");
