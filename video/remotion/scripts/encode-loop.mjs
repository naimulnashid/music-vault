/**
 * The landing page versions of the loop, from the 1080p render: 1280x720,
 * silent, small enough to autoplay. MP4 (H.264) plays everywhere; WebM (VP9)
 * is smaller where it plays; the poster is its first frame, shown before it
 * plays and to visitors who ask for reduced motion. Written to video/out and
 * copied into apps/site/public/video, which the site's hero serves. Needs
 * ffmpeg on PATH (or FFMPEG=path).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(VIDEO, "out", "remotion");
const SITE = join(VIDEO, "..", "apps", "site", "public", "video");
const master = join(OUT, "loop-master.mp4");
const ffmpeg = (args) => {
  const r = spawnSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-i", master, "-an", "-vf", "scale=1280:720:flags=lanczos", ...args], { stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
};

ffmpeg(["-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(OUT, "loop.mp4")]);
ffmpeg(["-c:v", "libvpx-vp9", "-crf", "38", "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p", join(OUT, "loop.webm")]);
ffmpeg(["-frames:v", "1", "-c:v", "libwebp", "-quality", "82", join(OUT, "loop-poster.webp")]);

mkdirSync(SITE, { recursive: true });
for (const f of ["loop.mp4", "loop.webm", "loop-poster.webp"]) copyFileSync(join(OUT, f), join(SITE, `hero-${f}`));
