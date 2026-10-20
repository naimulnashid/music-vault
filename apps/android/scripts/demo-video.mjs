/**
 * Phone footage for the demo video, from invented data:
 *   node apps/android/scripts/demo-video.mjs      (or: npm run android:demo-video)
 *
 * 1. Builds the demo app and installs it on an emulator, never a phone
 *    (emulator.mjs): a running one, or the first AVD, started and stopped here.
 * 2. Plays the phone shot with taps and swipes found through the
 *    accessibility tree and records it with screenrecord, logging every touch
 *    so the Remotion project can draw it (a tap is too brief for Android's own
 *    "Show taps" to show in the recording).
 * 3. Crops off the status bar (it shows the device's clock and battery, not
 *    the app) and writes video/remotion/public/capture/android/phone.mp4 with
 *    shots.json beside it. Nothing else on the device changes.
 *
 * Needs the Android SDK and a JDK (see emulator.mjs) and ffmpeg on PATH (or
 * FFMPEG=path). The song plays silently: the demo's audio files are silent and
 * the soundtrack is laid over the whole video in Remotion.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ACTIVITY, ADB, adb, ANDROID, APK, build, PKG, runningEmulators, shell, sleep, startEmulator, statusBarHeight } from "./emulator.mjs";

const VIDEO = resolve(ANDROID, "..", "..", "video");
const OUT = join(VIDEO, "remotion", "public", "capture", "android");
const TMP = join(VIDEO, "out", "frames", "android");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const REMOTE = "/sdcard/mv-demo-video.mp4";
const FPS = 30;

/** Every node in the current screen with its text, description and bounds. */
function nodes(serial) {
  shell(serial, "uiautomator dump /sdcard/mv-ui.xml");
  const xml = shell(serial, "cat /sdcard/mv-ui.xml");
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const attr = (k) => n.match(new RegExp(`${k}="([^"]*)"`))?.[1] ?? "";
    const [x1, y1, x2, y2] = attr("bounds").match(/\d+/g).map(Number);
    return { text: attr("text"), desc: attr("content-desc"), x: (x1 + x2) / 2, y: (y1 + y2) / 2, area: (x2 - x1) * (y2 - y1) };
  });
}

/** The node labelled `label`; `pick` chooses when several match. */
function find(serial, label, pick = (all) => all[0]) {
  const all = nodes(serial).filter((n) => n.text === label || n.desc === label);
  if (all.length === 0) throw new Error(`nothing labelled "${label}" on screen`);
  return pick(all);
}

async function play(serial, size) {
  const events = [];
  let t0 = 0;
  const now = () => (performance.now() - t0) / 1000;
  const log = (e) => events.push({ t: Number(now().toFixed(3)), ...e });
  const norm = (p) => ({ x: Number((p.x / size.width).toFixed(4)), y: Number((p.y / size.height).toFixed(4)) });
  const tap = async (p) => {
    log({ type: "tap", ...norm(p) });
    shell(serial, `input tap ${Math.round(p.x)} ${Math.round(p.y)}`);
  };
  const swipe = async (from, to, ms) => {
    log({ type: "swipe", ...norm(from), to: norm(to), ms });
    shell(serial, `input swipe ${from.x} ${from.y} ${to.x} ${to.y} ${ms}`);
  };
  const mid = size.width / 2;

  // Rehearse first, unrecorded: reading the screen takes seconds a tap, which
  // would leave dead air in the clip. The rehearsal finds every target and
  // ends back on the library with nothing playing.
  // The mini player: the lowest "Saltwater Hours" on screen.
  const mini = find(serial, "Saltwater Hours", (all) => all.reduce((a, b) => (b.y > a.y ? b : a)));
  shell(serial, `input tap ${mini.x} ${mini.y}`);
  await sleep(1800);
  // The full player's big Play, not the mini player's small one.
  const bigPlay = find(serial, "Play", (all) => all.reduce((a, b) => (b.area > a.area ? b : a)));
  shell(serial, "input keyevent 4");
  await sleep(1200);
  const stats = find(serial, "Stats");

  const recorder = spawn(ADB, ["-s", serial, "shell", "screenrecord", "--bit-rate", "20000000", REMOTE], { stdio: "ignore" });
  t0 = performance.now();
  await sleep(1500);
  await swipe({ x: mid, y: size.height * 0.7 }, { x: mid, y: size.height * 0.35 }, 500);
  await sleep(1200);
  await swipe({ x: mid, y: size.height * 0.35 }, { x: mid, y: size.height * 0.7 }, 500);
  await sleep(1200);
  await tap(mini);
  await sleep(1800);
  await tap(bigPlay);
  await sleep(3500);
  log({ type: "key", key: "Back" });
  shell(serial, "input keyevent 4");
  await sleep(1000);
  await tap(stats);
  await sleep(2200);
  await swipe({ x: mid, y: size.height * 0.75 }, { x: mid, y: size.height * 0.3 }, 900);
  await sleep(2000);
  const duration = now();

  // screenrecord finishes the file on SIGINT; give it a moment to write.
  shell(serial, "pkill -INT screenrecord");
  await new Promise((r) => (recorder.exitCode !== null ? r() : recorder.on("exit", r)));
  await sleep(1000);
  return { duration, events };
}

build();
let serial = runningEmulators()[0];
const started = !serial;
if (started) serial = await startEmulator();
try {
  adb(serial, ["install", "-r", APK]);
  shell(serial, `pm clear ${PKG}`);
  shell(serial, `pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
  const top = statusBarHeight(serial);
  const [width, height] = shell(serial, "wm size").match(/(\d+)x(\d+)/).slice(1).map(Number);
  // First start seeds the library; then open the library fresh, in dark.
  shell(serial, `am start -W -n ${ACTIVITY} --es demo_theme dark --es demo_screen library`);
  await sleep(6000);
  shell(serial, `am start -W -n ${ACTIVITY} --es demo_theme dark --es demo_screen library`);
  await sleep(2500);

  const { duration, events } = await play(serial, { width, height });

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const raw = join(TMP, "phone-raw.mp4");
  adb(serial, ["pull", REMOTE, raw]);
  shell(serial, `rm ${REMOTE} /sdcard/mv-ui.xml`);
  const file = join(OUT, "phone.mp4");
  const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-i", raw,
    "-vf", `crop=${width}:${height - top}:0:${top},fps=${FPS},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-an", file], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  // Event positions are for the full screen; the clip starts below the status bar.
  const crop = (p) => ({ ...p, y: Number(((p.y * height - top) / (height - top)).toFixed(4)) });
  const shifted = events.map((e) => ("y" in e ? crop("to" in e ? { ...e, to: crop(e.to) } : e) : e));
  const manifest = { fps: FPS, shots: { phone: { duration: Number(duration.toFixed(3)), width, height: height - top, events: shifted } } };
  writeFileSync(join(OUT, "shots.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${file} (${duration.toFixed(1)}s)`);
} finally {
  shell(serial, `am force-stop ${PKG}`);
  // Only an emulator this script started.
  if (started) spawnSync(ADB, ["-s", serial, "emu", "kill"], { stdio: "ignore" });
}
