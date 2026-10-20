/**
 * The emulator and demo build shared by demo-shots.mjs (README screenshots)
 * and demo-video.mjs (the demo video's phone footage).
 *
 * build() makes the `demo` build type (com.musicvault.demo): no Supabase
 * settings, and on start it loads the made-up library in DemoLibrary.kt. Only
 * serials starting with "emulator-" are ever used, never a phone.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ANDROID = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PKG = "com.musicvault.demo";
export const ACTIVITY = `${PKG}/com.musicvault.MainActivity`;
export const APK = join(ANDROID, "app", "build", "outputs", "apk", "demo", "app-demo.apk");
export const WIN = process.platform === "win32";
export const exe = (name) => (WIN ? `${name}.exe` : name);

export function sdkDir() {
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

export const SDK = sdkDir();
export const ADB = join(SDK, "platform-tools", exe("adb"));
export const EMULATOR = join(SDK, "emulator", exe("emulator"));

export function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const studio = "C:\\Program Files\\Android\\Android Studio\\jbr";
  if (WIN && existsSync(studio)) return studio;
  throw new Error("No JDK: set JAVA_HOME");
}

export function adb(serial, args, options = {}) {
  const r = spawnSync(ADB, ["-s", serial, ...args], { maxBuffer: 64 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`adb ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

export const shell = (serial, cmd) => adb(serial, ["shell", cmd], { encoding: "utf8" });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function build() {
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

export function runningEmulators() {
  const out = spawnSync(ADB, ["devices"], { encoding: "utf8" }).stdout ?? "";
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .filter(([serial, state]) => serial?.startsWith("emulator-") && state === "device")
    .map(([serial]) => serial);
}

export async function startEmulator() {
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
export function statusBarHeight(serial) {
  const m = shell(serial, "dumpsys window").match(/type=statusBars frame=\[0,0\]\[\d+,(\d+)\]/);
  if (!m) throw new Error("could not read the status bar height");
  return Number(m[1]);
}
