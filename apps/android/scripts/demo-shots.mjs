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
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { ACTIVITY, ADB, adb, ANDROID, APK, build, PKG, runningEmulators, shell, sleep, startEmulator, statusBarHeight } from "./emulator.mjs";

const OUT = resolve(ANDROID, "..", "..", "docs", "screenshots");

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
