/**
 * README screenshots of the Android app from invented data:
 *   node apps/android/scripts/demo-shots.mjs      (or: npm run android:demo-shots)
 *
 * 1. Builds the `demo` build type (com.musicvault.demo): no Supabase settings,
 *    and on start it loads the made-up library in DemoLibrary.kt, the same one
 *    the web demo shows. Its own application id keeps it apart from a real
 *    install on the same device.
 * 2. Installs it on an emulator (a running one, or the AVD named by
 *    MV_SHOTS_AVD / the first AVD, started and stopped by this script) and
 *    never on a phone: only serials starting with "emulator-" are used.
 * 3. Opens each screen in the dark and the light theme, captures it with
 *    screencap, crops off the status bar and writes android-*.webp to
 *    docs/screenshots/ at the repo root. Nothing else on the device changes.
 *
 * Needs the Android SDK (local.properties sdk.dir, ANDROID_HOME or
 * ANDROID_SDK_ROOT) and a JDK (JAVA_HOME, or Android Studio's on Windows).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ANDROID = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ANDROID, "..", "..", "docs", "screenshots");
const PKG = "com.musicvault.demo";
const ACTIVITY = `${PKG}/com.musicvault.MainActivity`;
const APK = join(ANDROID, "app", "build", "outputs", "apk", "demo", "app-demo.apk");
const WIN = process.platform === "win32";
const exe = (name) => (WIN ? `${name}.exe` : name);

function sdkDir() {
  const props = join(ANDROID, "local.properties");
  if (existsSync(props)) {
    const line = readFileSync(props, "utf8").split(/\r?\n/).find((l) => l.startsWith("sdk.dir="));
    // local.properties escapes ':' and '\' on Windows.
    if (line) return line.slice("sdk.dir=".length).replace(/\\:/g, ":").replace(/\\\\/g, "\\");
  }
  const env = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (env) return env;
  throw new Error("Android SDK not found: set sdk.dir in apps/android/local.properties or ANDROID_HOME");
}

const SDK = sdkDir();
const ADB = join(SDK, "platform-tools", exe("adb"));
const EMULATOR = join(SDK, "emulator", exe("emulator"));

function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const studio = "C:\\Program Files\\Android\\Android Studio\\jbr";
  if (WIN && existsSync(studio)) return studio;
  throw new Error("No JDK: set JAVA_HOME");
}

function adb(serial, args, options = {}) {
  const r = spawnSync(ADB, ["-s", serial, ...args], { maxBuffer: 64 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`adb ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

const shell = (serial, cmd) => adb(serial, ["shell", cmd], { encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function build() {
  const env = { ...process.env, JAVA_HOME: javaHome() };
  const tasks = "assembleDemo --console=plain";
  // gradlew.bat needs cmd, by full path: with NoDefaultCurrentDirectoryInExePath
  // set, cmd won't run it from the current folder by name. The quoting is
  // what Node itself uses for shell: true, so a path with spaces works.
  const r = WIN
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `""${join(ANDROID, "gradlew.bat")}" ${tasks}"`], { cwd: ANDROID, env, stdio: "inherit", windowsVerbatimArguments: true })
    : spawnSync(join(ANDROID, "gradlew"), tasks.split(" "), { cwd: ANDROID, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error("assembleDemo failed");
}

function runningEmulators() {
  const out = spawnSync(ADB, ["devices"], { encoding: "utf8" }).stdout ?? "";
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .filter(([serial, state]) => serial?.startsWith("emulator-") && state === "device")
    .map(([serial]) => serial);
}

async function startEmulator() {
  const avds = spawnSync(EMULATOR, ["-list-avds"], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
  const avd = process.env.MV_SHOTS_AVD || avds[0];
  if (!avd) throw new Error("No emulator is running and no AVD exists to start");
  const before = new Set(runningEmulators());
  const proc = spawn(EMULATOR, ["-avd", avd, "-no-snapshot-load", "-no-snapshot-save", "-no-audio", "-no-boot-anim"], { stdio: "ignore", detached: true });
  proc.unref();
  for (let i = 0; i < 180; i++) {
    const serial = runningEmulators().find((s) => !before.has(s));
    if (serial && shell(serial, "getprop sys.boot_completed").trim() === "1") return serial;
    await sleep(1000);
  }
  throw new Error(`emulator ${avd} did not boot`);
}

/**
 * Height of the status bar in pixels, cropped off every shot: what it shows
 * (clock, battery, notifications) belongs to the device, not the app.
 */
function statusBarHeight(serial) {
  const m = shell(serial, "dumpsys window").match(/type=statusBars frame=\[0,0\]\[\d+,(\d+)\]/);
  if (!m) throw new Error("could not read the status bar height");
  return Number(m[1]);
}

const SHOTS = ["library", "album", "now-playing", "statistics", "downloads"];

async function capture(serial) {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.startsWith("android-") && f.endsWith(".webp")) rmSync(join(OUT, f));

  adb(serial, ["install", "-r", APK]);
  shell(serial, `pm clear ${PKG}`);
  shell(serial, `pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
  const top = statusBarHeight(serial);
  try {
    // First start seeds the library; give it time before the first capture.
    shell(serial, `am start -W -n ${ACTIVITY} --es demo_theme dark --es demo_screen library`);
    await sleep(6000);
    for (const theme of ["dark", "light"]) {
      for (const shot of SHOTS) {
        shell(serial, `am start -W -n ${ACTIVITY} --es demo_theme ${theme} --es demo_screen ${shot}`);
        await sleep(2500);
        const png = adb(serial, ["exec-out", "screencap", "-p"]);
        const file = join(OUT, theme === "dark" ? `android-${shot}.webp` : `android-${shot}-light.webp`);
        const { width, height } = await sharp(png).metadata();
        await sharp(png).extract({ left: 0, top, width, height: height - top }).webp({ quality: 82 }).toFile(file);
        console.log("wrote", file);
      }
    }
  } finally {
    shell(serial, `am force-stop ${PKG}`);
  }
}

build();
let serial = runningEmulators()[0];
const started = !serial;
if (started) serial = await startEmulator();
try {
  await capture(serial);
} finally {
  // Only an emulator this script started.
  if (started) spawnSync(ADB, ["-s", serial, "emu", "kill"], { stdio: "ignore" });
}
