/**
 * App footage for the demo video, from invented data:
 *   npm run demo:video -w music-vault-web [-- shot ...]
 *
 * 1. Builds and serves the demo (demo-server.mjs): the made-up library, no
 *    account, `next start` on 127.0.0.1:3300.
 * 2. Plays each storyboard shot in Playwright's Chromium and records the page
 *    with the DevTools screencast: 1080p frames, each stamped when it
 *    arrives. ffmpeg holds every frame until the next one, which turns them
 *    into a steady 30 fps clip however fast the machine was.
 * 3. Logs every pointer move, click, drag and keystroke with its time and
 *    position, so the Remotion project draws the cursor and zooms on clicks.
 *
 * Writes video/remotion/public/capture/web/<shot>.mp4 and shots.json there.
 * The song that plays gets the video's soundtrack instead of the demo's
 * silent file, so the visualizer moves; that needs video/assets/vintage_menu.wav
 * (see video/CREDITS.md). Needs ffmpeg on PATH (or FFMPEG=path).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { BASE, buildDemo, startDemo, WEB } from "./demo-server.mjs";

const VIDEO = resolve(WEB, "..", "..", "video");
const OUT = join(VIDEO, "remotion", "public", "capture", "web");
const FRAMES = join(VIDEO, "out", "frames", "web");
const SOUNDTRACK = join(VIDEO, "assets", "vintage_menu.wav");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const W = 1920;
const H = 1080;
// The screencast sends CSS pixels whatever the device scale, so record at the video's own size.
const SCALE = 1;
const FPS = 30;

function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

/** What a shot can do. `log` gets every pointer and key event; it does nothing when rehearsing. */
function actions(page, log, name) {
  const hold = (ms) => page.waitForTimeout(ms);
  const at = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    if (!b) throw new Error(`${name}: nothing to point at`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const norm = (p) => ({ x: Number((p.x / W).toFixed(4)), y: Number((p.y / H).toFixed(4)) });
  // The pointer travels for `travel` ms before it acts; Remotion draws the same path.
  const point = async (locator, travel = 650) => {
    const p = await at(locator);
    log({ type: "move", ...norm(p), ms: travel });
    await page.mouse.move(p.x, p.y, { steps: 20 });
    await hold(travel);
    return p;
  };
  const click = async (locator, travel) => {
    const p = await point(locator, travel);
    log({ type: "click", ...norm(p) });
    await page.mouse.click(p.x, p.y);
  };
  const dblclick = async (locator, travel) => {
    const p = await point(locator, travel);
    log({ type: "dblclick", ...norm(p) });
    await page.mouse.dblclick(p.x, p.y);
  };
  const type = async (text) => {
    log({ type: "type", text });
    await page.keyboard.type(text, { delay: 120 });
  };
  const key = async (k) => {
    log({ type: "key", key: k });
    await page.keyboard.press(k);
  };
  const scroll = async (dy, ms = 1600) => {
    log({ type: "scroll", dy, ms });
    const steps = Math.round(ms / 25);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, dy / steps);
      await hold(25);
    }
  };
  const drag = async (from, to, ms = 1000) => {
    const a = await point(from);
    const b = await at(to);
    log({ type: "down", ...norm(a) });
    await page.mouse.down();
    const steps = Math.round(ms / 30);
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x, a.y + ((b.y - a.y) * i) / steps);
      await hold(30);
    }
    log({ type: "up", ...norm(b) });
    await page.mouse.up();
  };
  return { page, hold, point, click, dblclick, type, key, scroll, drag };
}

/** Records one shot: runs `steps`, then encodes the frames and returns the event log. */
async function record(page, name, steps) {
  const dir = join(FRAMES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const events = [];
  let t0 = 0;
  const now = () => performance.now() / 1000 - t0;
  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    const file = join(dir, `${String(frames.length + 1).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: now() });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  t0 = performance.now() / 1000;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * SCALE, maxHeight: H * SCALE });

  await steps(actions(page, (e) => events.push({ t: Number(now().toFixed(3)), ...e }), name));
  const end = now();
  await cdp.send("Page.stopScreencast");
  await cdp.detach();
  if (frames.length === 0) throw new Error(`${name}: no frames recorded`);

  // Each frame shows until the next one arrives; the first fills from the start.
  const list = frames.map((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    const from = i === 0 ? 0 : f.t;
    return `file '${f.file.replace(/\\/g, "/")}'\nduration ${Math.max(0.001, next - from).toFixed(4)}`;
  });
  list.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
  const listFile = join(dir, "frames.txt");
  writeFileSync(listFile, list.join("\n") + "\n");
  const file = join(OUT, `${name}.mp4`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=${FPS},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-r", String(FPS), file]);
  console.log(`wrote ${file} (${frames.length} frames over ${end.toFixed(1)}s)`);
  return { duration: Number(end.toFixed(3)), width: W * SCALE, height: H * SCALE, events };
}

const nav = (page, label) =>
  page.locator("nav button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).filter({ visible: true }).first();
const main = (page) => page.locator("main");

/** The storyboard, in order. Each shot starts where the last one left the app. */
const SHOTS = {
  library: async ({ page, hold, point, click, type, key, scroll }) => {
    await hold(1200);
    await point(main(page).locator("h1").first());
    await scroll(900);
    await hold(400);
    await scroll(-900, 900);
    await click(page.getByPlaceholder("Search songs, albums, artists"));
    await type("Mira");
    await hold(1800);
    await key("Escape");
    await hold(300);
    await click(nav(page, "Albums"));
    await hold(1000);
    await click(main(page).getByText("Saltwater Hours", { exact: true }).first());
    await hold(1500);
  },
  play: async ({ page, hold, click, dblclick, key }) => {
    // The song itself, not the album's Play: the album starts from another song,
    // and only this one has audio in the demo.
    await dblclick(main(page).locator("div.text-sm.font-medium", { hasText: /^Saltwater Hours$/ }));
    await hold(1500);
    await click(page.getByRole("button", { name: "Open player" }).filter({ visible: true }).first());
    await hold(2500);
    await click(page.locator("button.h-11", { hasText: "Lyrics" }));
    await hold(6000);
    await key("Escape");
    await hold(600);
    // The visualizer follows the soundtrack swapped in at the start.
    const visualizer = page.getByRole("button", { name: "Visualizer" }).filter({ visible: true }).first();
    await click(visualizer);
    await hold(3500);
    await click(visualizer);
    await hold(500);
  },
  playlists: async ({ page, hold, click, drag }) => {
    await click(page.locator("nav").getByText("Road Trip", { exact: true }).filter({ visible: true }).first());
    await hold(1200);
    const handles = main(page).locator('[title="Drag to reorder"]');
    await drag(handles.nth(1), handles.nth(3));
    await hold(1200);
    await click(page.locator("nav").getByText("Bangla", { exact: true }).filter({ visible: true }).first());
    await hold(2200);
  },
  offline: async ({ page, hold, click, scroll }) => {
    await click(nav(page, "Downloads"));
    await hold(2200);
    await scroll(500, 1400);
    await hold(1200);
  },
  stats: async ({ page, hold, click, point, scroll }) => {
    await click(nav(page, "Statistics"));
    await hold(1800);
    await point(main(page).locator("h1").first());
    await scroll(1100, 2600);
    await hold(2000);
  },
  theme: async ({ page, hold, click, key }) => {
    await click(page.locator('button[title="you@example.com"]'));
    await hold(700);
    await click(page.getByRole("button", { name: "Light", exact: true }).filter({ visible: true }).first());
    await hold(500);
    await key("Escape");
    await click(nav(page, "Library"));
    await hold(2200);
  },
};

// --no-build reuses the last demo build (.next-demo) while working on the shots.
const args = process.argv.slice(2);
const wanted = args.filter((a) => !a.startsWith("--"));
for (const w of wanted) if (!(w in SHOTS)) throw new Error(`unknown shot ${w}; shots: ${Object.keys(SHOTS).join(", ")}`);
if (!existsSync(SOUNDTRACK)) console.warn(`no ${SOUNDTRACK}: the visualizer will stay flat`);

mkdirSync(OUT, { recursive: true });
if (!args.includes("--no-build")) buildDemo();
const stop = await startDemo();
try {
  const browser = await chromium.launch({ executablePath: process.env.MV_SHOTS_BROWSER || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
    const page = await context.newPage();
    if (existsSync(SOUNDTRACK)) {
      // Five minutes: the song resumes at 1:14 and must not end during the
      // shots, or the player moves on to a song with no audio in the demo.
      const excerpt = join(FRAMES, "..", "soundtrack.wav");
      mkdirSync(join(FRAMES, ".."), { recursive: true });
      ffmpeg(["-i", SOUNDTRACK, "-t", "300", excerpt]);
      await page.route(`${BASE}/__soundtrack`, (route) => route.fulfill({ path: excerpt, contentType: "audio/wav" }));
      // The demo writes the playing song's silent file on every load and the
      // player opens it straight away, so a swap afterwards comes too late.
      // Hand over the soundtrack as that one file is written instead.
      await page.addInitScript(() => {
        const open = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = async function (...args) {
          const w = await open.apply(this, args);
          if (this.name !== "demo-1-0") return w;
          const bytes = await (await fetch("/__soundtrack")).arrayBuffer();
          const write = w.write.bind(w);
          w.write = () => write(bytes);
          return w;
        };
      });
    }
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const bar = page.locator("div.backdrop-blur-2xl.border-t").first();
    await bar.getByText("Saltwater Hours").first().waitFor({ timeout: 120_000 });
    // Start from the dark theme whatever the system says.
    await page.click('button[title="you@example.com"]');
    await page.getByRole("button", { name: "Dark", exact: true }).filter({ visible: true }).first().click();
    await page.keyboard.press("Escape");
    await page.mouse.move(W - 1, H / 2);
    await page.waitForTimeout(800);

    // Re-recording some shots keeps the others' entries. Every shot still runs,
    // unrecorded when not wanted, so each one starts from the state it expects.
    const manifestFile = join(OUT, "shots.json");
    const manifest = wanted.length && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { shots: {} };
    Object.assign(manifest, { fps: FPS, viewport: { width: W, height: H } });
    try {
      for (const [name, steps] of Object.entries(SHOTS)) {
        if (wanted.length && !wanted.includes(name)) await steps(actions(page, () => {}, name));
        else {
          manifest.shots[name] = await record(page, name, steps);
          // Saved after every shot, so a later failure keeps the ones already recorded.
          writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
        }
      }
    } catch (e) {
      // What the page showed when a step failed, to see which control was missing.
      const shot = join(VIDEO, "out", "capture-error.png");
      await page.screenshot({ path: shot }).catch(() => {});
      console.error(`failed; the page at that moment: ${shot}`);
      throw e;
    }
    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
