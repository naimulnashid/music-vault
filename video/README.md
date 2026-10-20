# Demo video

The product demo video is made from code: app footage recorded from the web app's demo build
(an invented library, no account), then edited in [Remotion](https://www.remotion.dev/) with a
drawn cursor, zooms on clicks, captions and music. Nothing in it comes from a real library.

## Make it

Run from the repo root, in any shell. You need ffmpeg on PATH and Playwright's Chromium
(`npx playwright install chromium`).

1. Download the music as described in [CREDITS.md](CREDITS.md) and save it as
   `video/assets/vintage_menu.wav`.
2. Record the app footage. This builds the demo into `apps/web/.next-demo/`, serves it with
   `next start` on 127.0.0.1:3300 and stops it when done (add `-- --no-build` to reuse the last
   build, or name shots to re-record only those):

   ```bash
   npm run demo:video -w music-vault-web
   ```

3. Record the phone footage. This builds the Android demo app and plays the phone shot on an
   emulator (a running one, or the first AVD, started and stopped by the script; never a phone).
   It needs the Android SDK and a JDK, as for the [Android screenshots](../README.md). Without it
   the cut leaves the phone shot out.

   ```bash
   npm run android:demo-video
   ```

4. Install the Remotion project once, then render:

   ```bash
   npm install --prefix video/remotion
   ```

   ```bash
   npm run video:render
   ```

The cut is written to `video/out/remotion/main.mp4`, and the landing page loop (15 seconds, silent,
1280x720) to `loop.mp4` and `loop.webm` beside it. `npm run render:main` or `npm run render:loop`
in `video/remotion` makes just one of them. Everything under `video/out/`,
`video/assets/` and the generated files in `video/remotion/public/` stays out of git.

## How it fits together

- `apps/web/scripts/demo-video.mjs` plays each storyboard shot and records it with the DevTools
  screencast, logging every pointer move, click, drag and keystroke to `shots.json`.
- `apps/android/scripts/demo-video.mjs` records the phone shot with `screenrecord`, logging each
  tap and swipe for Remotion to draw, and crops off the status bar.
- `video/remotion/src/Main.tsx` holds the storyboard: the order of the parts and each shot's
  captions. `AppShot.tsx` draws the footage in a window with the cursor, click ripples and camera
  zoom computed from that log; `PhoneShot.tsx` puts the phone clip in a drawn phone; `Loop.tsx`
  picks the loop's moments from the same footage and ends on its own first frame; `Title.tsx`,
  `HowItWorks.tsx` and `EndCard.tsx` are the motion
  graphics.

Remotion is not open source: it is free for individuals and for companies of up to 3 people.
See its [license](https://www.remotion.dev/docs/license) before using this folder at work.
