// Renders every app's icon files from the one source, apps/site/public/favicon.svg.
// Run from the repo root: node scripts/make-icons.mjs
// The Android launcher icon is a vector drawable kept by hand in
// apps/android/app/src/main/res/drawable/ic_launcher_*.xml, and the in-app mark
// in apps/{desktop,web}/src/components/Logo.tsx; change those with the source.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("apps/site/public/favicon.svg", "utf8");
// Full-bleed square for maskable and Apple icons: the system rounds the corners,
// and the artwork shrinks into the middle 80% so no mask crops it.
const fullBleed = svg
  .replace(/<rect width="512" height="512" rx="120"/g, '<rect width="512" height="512"')
  .replace(/(<\/rect>|\/>)(<circle)/, '$1<g transform="translate(51.2 51.2) scale(.8)">$2')
  .replace(/<\/svg>\s*$/, "</g></svg>");

async function png(source, size, out) {
  await sharp(Buffer.from(source), { density: 72 * (size / 512) * 2 }).resize(size, size).png().toFile(out);
  console.log("wrote", out);
}

await png(svg, 1024, "apps/desktop/src-tauri/icons/icon-source.png");
await png(svg, 512, "apps/web/src/app/icon.png");
await png(svg, 192, "apps/web/public/icons/icon-192.png");
await png(svg, 512, "apps/web/public/icons/icon-512.png");
await png(fullBleed, 512, "apps/web/public/icons/maskable-512.png");
await png(fullBleed, 256, "apps/web/src/app/apple-icon.png");
// The Windows app's icons (icon.ico and the Store tiles) come from the Tauri CLI.
execSync("npx tauri icon src-tauri/icons/icon-source.png", { cwd: "apps/desktop", stdio: "inherit" });
writeFileSync("apps/web/src/app/favicon.ico", readFileSync("apps/desktop/src-tauri/icons/icon.ico"));
