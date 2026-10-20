/**
 * Copies the soundtrack into public/ for Remotion's staticFile(), plus a short
 * mono excerpt the title card's bars analyse (decoding the whole 5-minute WAV
 * in every render tab would be slow). The track is CC0 but not committed (see
 * video/CREDITS.md for where to get it), so this stops with that pointer when
 * it is missing. Needs ffmpeg on PATH (or FFMPEG=path).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(ROOT, "..", "assets", "vintage_menu.wav");
const to = join(ROOT, "public", "music", "vintage_menu.wav");

if (!existsSync(from)) {
  console.error(`Missing ${from}. Download it as described in video/CREDITS.md.`);
  process.exit(1);
}
if (!existsSync(join(ROOT, "public", "capture", "web", "shots.json"))) {
  console.error("No app footage yet: run `npm run demo:video -w music-vault-web` from the repo root first.");
  process.exit(1);
}
if (!existsSync(to) || statSync(to).size !== statSync(from).size) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
const excerpt = join(ROOT, "public", "music", "title-excerpt.wav");
if (!existsSync(excerpt)) {
  const r = spawnSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-i", from, "-t", "10", "-ac", "1", "-ar", "22050", excerpt], { stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
}
