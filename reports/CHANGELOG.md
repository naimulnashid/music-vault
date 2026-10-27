# Changelog

> Audit date: 2026-07-17 · branch `main` @ `e3b5237`; the vault migration entry added 2026-10-13.
> **Generated from commit history** (45 commits, 2026-07-14 → 2026-07-17, single branch, no merges,
> then the vault migration, 2026-10-11 → 13).
> The repository ships no changelog and no version tags; the version `1.0.0` is read from
> [package.json](../package.json), [Cargo.toml](../apps/desktop/src-tauri/Cargo.toml) and
> [tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json) (Android: `versionName "1.0"`,
> `versionCode 1`).
> Entries are grouped by release and theme rather than one line per commit.
> Format follows [Keep a Changelog](https://keepachangelog.com/) conventions.
> Releases since: `v1.0.0` and `v1.1.0`, both 2026-10-15, published as source on the public repo
> (see [Notes on this changelog](#notes-on-this-changelog)); `v1.2.0`, 2026-10-20, published the
> same way; `v1.3.0`, `v1.3.1` and `v1.4.0`, all 2026-10-21, published the same way.

---

## [Unreleased]

### Added
- **By Country** smart playlist on every app, after By Language. By Artist now comes before By
  Genre.
- Statistics: Top Years, Top Countries and Top Languages, and a Play Time by Device donut. Play
  events already carried the device that played them; the charts name each device from the
  account's device list, show devices of the same name as one slice, give the five most-played
  devices their own slice and fold the rest into "Other devices".
- Web and desktop: a list or cover view on Library, Downloads, the built-in smart playlists,
  playlists, artist pages and genre/year/language/country groups. The choice is kept per page on
  that device.
- Desktop: Ctrl+plus, Ctrl+minus, Ctrl+0 and Ctrl+mouse wheel zoom the window, as in a browser.
  The top bar shows the level for a moment after each change, with minus and plus buttons, and
  keeps a small "110%" button while the window isn't at 100% (click it to reset). The level is
  kept for the next start.
- Desktop: a song uploaded from the PC is copied into the auto-cache once its upload commits
  (into downloads while "Download all songs automatically" is on), checked against its BLAKE3
  hash as a download is, so its first play there doesn't download it back. A file moved or
  re-saved since it was added is skipped, and nothing is kept while the auto-cache is off.
- Desktop: Backup Music Vault, on a new Settings page (account menu → Settings), keeps a full
  copy of the vault in a folder you choose, so the library survives losing the Supabase database
  or R2: `Music` holds every song, `Covers` every cover at full size (`<sha256>.jpg`), `Artist
  photos` the picked photos, `Database` the account's rows from the sync shadow as JSON (tracks,
  playlists, playlist items, favourites, ratings, play events, settings, queue, devices) and
  `Backup info.json` when it last finished and what it holds. The songs are ordinary files,
  `Music\Artist\Album\Title.ext`, with its current details, cover and ReplayGain written
  into it and synced lyrics as a `.lrc` beside it, so any player can use the folder without the
  app. It updates itself after each sync: new songs are written, edited ones retagged or renamed,
  and songs deleted from the vault move to `Removed from vault` (nothing is deleted). Songs this
  PC already has are copied rather than downloaded, and a run that wouldn't fit the drive doesn't
  start. MP3, AAC, WAV and AIFF get ID3v2.4 tags (lofty's 2.3 output is unreadable), FLAC, Ogg
  and Opus Vorbis comments, M4A/MP4 iTunes tags and WavPack/APE APE tags; a format that can't be
  tagged (Ogg FLAC) is copied as it is. Uploading a mirror copy of a song still in the vault is
  refused; a copy of a deleted song uploads as new. Desktop SQLite v10 adds `mirror_entries`.
  The setting moved from `mirror_dir` to `backup_dir`, so a folder set up while this was the
  Downloads page's Library mirror is left as it is and a backup starts in the folder you pick.
- Desktop: a Settings page, opened from the account menu. Song change notifications moved there
  from the account menu, beside Backup Music Vault and the zoom level.
- Desktop: a Download folder setting on the Downloads page. Change folder picks another folder
  and Use default goes back; the downloads already kept move there with progress (a rename on
  the same drive, a hash-checked copy across drives), and new ones follow. The folder is
  remembered on that PC only and can't be changed while downloads run. A download in use stays in
  the old folder and still plays from there; choosing the folder again retries it.
- Android: the upload form and track editor suggest artists, albums and genres while you type,
  and Language and Country open a list of every value in the library, as on desktop and web.
- Artist photos on every app: an artist page's menu chooses, changes or removes a photo, which
  then replaces the album art in the artist's circle everywhere and syncs to your other devices.
  Migration 0008 and the updated vault function are live (2026-10-22).
- Android: Monkey's Audio (`.ape`) and WavPack (`.wv`) songs play, seek, crossfade and go
  through the equalizer like the rest. Media3 has neither format, so the app gains APE and
  WavPack extractors and an `:ffmpeg` module: Media3's FFmpeg decoder extension with only the
  ape and wavpack decoders of FFmpeg 6.0.1, its native library prebuilt for arm64-v8a,
  armeabi-v7a and x86_64 (`apps/android/ffmpeg/build-ffmpeg.sh` rebuilds it). Seeking lands on
  the exact sample, not the start of a frame that can hold several seconds. The release APK
  grows by 1.6 MiB, each library being stored uncompressed (arm64-v8a 554 KiB, armeabi-v7a
  460 KiB, x86_64 585 KiB).

- Web and desktop: any playlist, and every group of By Genre, By Year, By Language and By
  Country, can take a cover picture instead of its song artwork, the way an artist takes a photo.
  "Choose cover" / "Change cover" and "Use default cover" sit in the page's "⋯" menu, and also
  outside it: right-click a playlist in the sidebar, or right-click a group's card or use the
  "⋯" that appears on it. The default cover is unchanged. Covers sync as settings rows (scope
  `collection_cover`); migration 0009, live since 2026-10-27, lets other devices read them.

### Changed
- Every app: a refreshed icon. The violet tile and beamed notes stay; a faint record now sits
  behind the notes, with a soft light from the top left and a shadow under the notes. One source,
  `apps/site/public/favicon.svg`, and `node scripts/make-icons.mjs` renders the web and Windows
  icon files from it; Android's adaptive icon is its vector twin, with a notes-only themed icon.
- Android: By Artist, By Genre, By Year, By Language and By Country show a card per group with
  its cover, as on desktop and web, instead of one long list of expanding rows. A group opens on
  its own page (header with Play, Shuffle and Download, then its songs); artists still open their
  artist page. A long press on a group's card, or the ⋮ on its page, chooses a cover or goes back
  to the default one, and playlists show a cover picked on any device.
- Android: the Library page no longer has Play and Shuffle buttons at the top; tapping a song
  plays from there, as before.
- Android: a Settings page, opened from the account menu, with the notification state and a way
  to the system's notification settings, and the app version. Appearance stays in the menu.
- Statistics: larger chart text, axis labels and tooltips, and a bigger Play Time by Device
  donut.
- Web and desktop: the upload screen clears itself when an upload finishes. Uploaded songs
  leave the list (the footer says how many went up), and once nothing is left the batch fields
  and cover are emptied for the next upload. Songs that failed stay, with what was typed, to be
  tried again.
- Every app: the light theme puts white cards on a grey page with firmer borders, so sections
  such as the Downloads page's cards stand out as they do in the dark theme.
- The web Help page's Desktop extras cover the Download folder setting and Backup Music Vault.
- A comma in an artist or genre tag separates two names: "A, B" is listed under both A and B in
  By Artist and By Genre, and the song shows on both artist pages.
- Language and Country in the upload form and track editor list every value when opened, even
  with a wrong value typed; artist, album and genre suggest only matches. The same lists now fill
  in smart playlist rules: Language and Country show every name, the other text fields suggest
  matches as you type.
- The release date field takes digits only and puts the hyphens in (2019-05-14); a date left
  as "2019-" saves as 2019.
- Statistics: the Listening Activity and Listening Clock charts have a time axis with gridlines,
  the Listening Clock follows Listening Activity, every section sits in its own card, and the top
  lists show five entries, two per row (Android: two per row on screens 600 dp and wider). Top
  Genres, Years, Countries and Languages open the matching group, and Top Artists and Top Genres
  count a play once for each comma-separated name.
- The Windows installer no longer ticks "Create desktop shortcut", and silent installs no longer
  leave one.
- Desktop: the startup cleanup of interrupted downloads deletes only the app's own
  `<hash>.<ext>.part` files, since the download folder may now be shared with other files. While
  the download folder is on a drive that isn't plugged in, new downloads go to the default folder
  and the songs kept on that drive stay indexed for when it is back.
- The README title starts with the app icon.
- The landing page hero shows the library screenshot again; the demo video loop is switched off
  for now. The loop files stay in `apps/site/public/video/` and in the video project, unused.

### Fixed
- Android upload: the screen moves above the keyboard so the field being typed in stays in
  view; the release date keeps its cursor after each digit (typing 2026-09-09 used to give
  2026-90-90) and has a calendar button; and the screen clears itself when an upload finishes,
  as on web and desktop.
- Web and desktop: text can be selected and copied anywhere (song details, statistics, lyrics,
  dialogs). Buttons and pictures still don't highlight when clicked, and double-clicking a song
  plays it without selecting a word.
- Every app: a comma in Country or Language now separates two values, as it does for artists and
  genres, so "Bangladesh, India" lists the song under Bangladesh and under India (By Country, By
  Language, Statistics) instead of making a third country. The field suggestions split them too.
- Statistics: plays of a song that was later deleted or replaced counted as "Unknown" track,
  album, year and language on the PC, because its local play log keyed them by a file that no
  longer exists. They now keep the song's details from the synced copy, and edited details reach
  the charts without reopening Statistics.
- Every app registers one device per machine: a reinstall or cleared storage takes the
  account's existing device of the same name instead of adding another, and Android no longer
  registers the same phone two or three times at once. The PC now registers under its own name
  ("<PC name> (Windows app)"), the web app as browser and system ("Web (Edge on Windows)", with
  test and built-in browsers named apart), and the Android emulator as "Android emulator".

## [1.4.0] - 2026-10-21

The queue follows you between all three apps (the last audit item, BUG-006), plus the web and
desktop fixes that made it work and one full sync per launch. Versions: 1.4.0 everywhere; Android
`versionCode 6`.

### Added
- The queue follows you between all three apps. Android now sends its queue (3 s after a change,
  half a second after a pause) and, at startup, takes over the queue another device left if that
  was written after the phone last played; otherwise it keeps its own. Web and desktop use the
  same newest-wins rule, paused at the same song and position, and never interrupt anything
  started since launch. Checked between the emulator and the Windows app in both directions.

### Fixed
- Web and desktop run one full sync at launch instead of two. Sync started as soon as the session
  appeared and again a moment later when the device registration landed, so every launch pulled
  the whole account twice and the first cycle's play events carried no device. Sync now waits for
  the registration attempt (successful or not, so it still starts offline), a session that
  recovers on its own reuses the device id, and stopping sync cancels a pending queue push so it
  can't fire into the next session.
- Web and desktop never actually picked up another device's queue after a restart: their own
  startup restore of the last song blocked it, and a startup pull that found the queue unchanged
  didn't offer it. They also sent that restore back out as their own queue a few seconds after
  launch (and again whenever a song's file path was filled in), so a stale song looked like the
  newest queue to other devices. Restores are no longer sent, and the handoff reads the latest
  server queue the engine already has.

## [1.3.1] - 2026-10-21

The last audit hardening (a desktop content security policy, large covers on Android) and a
desktop upload fix. Versions: 1.3.1 everywhere; Android `versionCode 5`.

### Security
- Windows app: a content security policy replaces none. The window may only run its own scripts
  and styles, load images from itself and the local artwork cache, and connect to Tauri and
  `*.supabase.co` (HTTPS and realtime); plugins and form posts are blocked. Checked in the
  installed app: library, artwork, sync (push, pull and realtime), playback, full player,
  visualizer, Upload with its file picker, Statistics, Downloads and Edit details all work.

### Fixed
- Windows app: a song file saved again after it was added to the upload list (for example a tag
  edit, which can keep a FLAC's size) is no longer uploaded under its old content hash. Such a
  song was stored but could never be downloaded ("downloaded bytes don't match"); the upload now
  hashes the bytes as it sends them and stops before the last chunk if they changed, so nothing
  is stored, and says to add the file again. Android and the web already upload exactly the bytes
  they hashed.
- Android: choosing a large photo as a cover no longer loads it at full size. It is decoded at a
  reduced size that still leaves the cover's 1,200 px edge sharp, and the in-between bitmaps are
  freed as soon as they're used. With an invented 8,000 x 6,000 px image on the emulator, the
  app's native memory stayed near its starting level (sampled every half second) instead of
  reaching 367 MB.

## [1.3.0] - 2026-10-21

Everything since `v1.2.0`: the rest of the 2026-10-19 audit fixes, including an Android security
fix. Versions: 1.3.0 everywhere; Android `versionCode 4`.

### Added
- An empty playlist shows an Add songs button on every app. It opens a searchable list of the
  library (the first 100 matches; search narrows it) where each song is added with one tap, without
  leaving the playlist. Smart playlists keep their "No songs match these rules yet." message.

### Changed
- The account menu's sync row says what a problem means for your edits, on every app. When sync
  is stuck it lists how many changes are kept on this device and when the device last synced
  (remembered across restarts), and offline with nothing waiting it says edits sync when you're
  back online. Web and desktop now show "Sign in again to sync" when the session can't be renewed;
  before, that reason was only in a hover tooltip behind "Sync issue".
- Web and desktop: naming a new playlist in the sidebar shows Create and Cancel buttons instead
  of relying on Enter or clicking away. Clicking away still saves a typed name; Escape cancels.

### Fixed
- Android syncs as soon as the phone is back online. It had no connectivity listener, so edits
  made offline waited for the next edit, a realtime event or Sync now; web and desktop already
  retried on the browser's online event.
- Android Auto: browsing a list longer than 500 songs returns every page. The browse tree ignored
  the requested page and sent the same first 500 each time; every node now returns the page asked
  for, and a client that doesn't page still gets the first 500.
- Docs and landing page: the queue no longer counts as syncing on Android. Windows and the web
  hand the queue to each other; Android keeps its queue on the phone (a known gap, not a
  regression).
- Sync (core and Android): removing or reordering songs in a playlist with more members than one
  server response holds (1,000 by default) now reaches the server. The member list was read in
  one request, so a song past the cut-off was skipped while the change still counted as synced,
  and an add could get the wrong position. Every sync read now also keeps paging until an empty
  page, so a project with a lower response cap no longer truncates pulls.
- Web at phone width: the full-screen player has Sleep timer, Visualizer and Sound buttons under
  the song title (they were only in the desktop-width bottom bar). The Up next panel no longer
  covers the artwork and title, and the player opens at the top instead of scrolled to the
  playing song in the queue; the queue and synced lyrics scroll only their own list.
- Web and desktop sync recover from an expired session: a refused token (PGRST301, JWT expired)
  is renewed once and the cycle retried, without counting against the queued changes; if it
  can't be renewed the status says "Sign in again to sync". A session that expires or is revoked
  no longer wipes unsynced edits as the user's own Sign out does: sync stops and the account's
  data leaves the screen, and its queued edits go up when the same account signs back in (they
  are cleared if a different account signs in). Android had the same fix in 1.2.0.

### Security
- Android: other apps can no longer browse the library or control playback through the media
  service. It is exported for the system, Bluetooth and Android Auto, and it accepted every app
  that connected. Now only Music Vault itself, the system, callers Android trusts for media control
  (System UI's media controls, apps the user gave notification access) and Android Auto or
  Automotive get in. Checked on an emulator with a separate test app, which was refused before
  and let in once it had notification access; the notification, lock-screen controls and media
  keys work as before. Android Auto itself was not tested.

## [1.2.0] - 2026-10-20

Everything since `v1.1.0`, including the fixes from the 2026-10-19 project and UX audits.
Versions: 1.2.0 everywhere; Android `versionCode 3`.

### Added
- Demo video: `npm run demo:video
  -w music-vault-web` records the app footage from the demo build (the invented library, served
  with `next start`) with the DevTools screencast, plus a log of every click, and `npm run
  android:demo-video` records the phone shot from the Android demo app on an emulator. A
  Remotion project in `video/remotion/` (its own package, not a workspace) edits them into the
  cut: title card, six web shots with a drawn cursor, zooms on clicks and captions, the phone
  shot with drawn touches, the How it works diagram and an end card, over CC0 music, plus a
  15-second silent loop for the landing page (MP4 and WebM, 1280x720) that ends on its first frame. The Android
  screenshot script shares the emulator helpers (`apps/android/scripts/emulator.mjs`). Steps in [video/README.md](../video/README.md), music credit in
  [video/CREDITS.md](../video/CREDITS.md). Remotion has its own license: free for individuals
  and for companies of up to 3 people. The demo's "Saltwater Hours" now has made-up synced
  lyrics, and the README screenshot scripts share the demo build helper
  (`scripts/demo-server.mjs`).
- A landing page in `apps/site` (Astro, static output): what Music Vault is, the three apps,
  features, the screenshots from `docs/screenshots/`, how it works, privacy and its limits, the
  four setup steps and an FAQ. No client framework, no third-party requests, no analytics; a CSP
  with hashed inline scripts. Deployed as its own Vercel project (Root Directory `apps/site`); see
  [docs/site-setup.md](../docs/site-setup.md). CI runs `site:check` and `site:build`.
- Landing page: a light/dark toggle in the header. First visits still follow the system theme; a
  choice is saved in the browser and applied before first paint, and choosing the system's own
  theme goes back to following the system. Screenshots and the browser's theme color follow the
  toggle. Without JavaScript the toggle is hidden and the page follows the system as before.
- README: Android screenshots (library, full player and statistics, plus an album and Downloads
  under More screens) in both themes. They come from `npm run android:demo-shots`: a `demo` build
  type (`com.musicvault.demo`, no Supabase settings) loads the same invented library as the web
  demo, and the script captures it on an emulator with the status bar cropped off.

### Changed
- `package-lock.json`: adding the landing page moved the shared Vite from 8.1.4 to 8.3.4 (and
  Rolldown with it), which Astro requires; the desktop app's declared range already allowed it,
  and its build and tests pass unchanged.
- The web screenshot script no longer deletes the Android shots in `docs/screenshots/`.
- README rewritten as a project front page: what it is, screenshots, features, how it works,
  requirements, running your own, development, documentation, contributing, security and license.
  The phase-by-phase build history moved out (it stays in PHASE_PROGRESS.md and this changelog).
- README: Release and License badges, and screenshots of the library, an album, the full player,
  statistics and downloads in both themes, captured from an invented demo library
  (`npm run demo:shots -w music-vault-web`; demo builds go to `apps/web/.next-demo/`).
- README: Configuration, Usage and Security and privacy sections; the Node requirement corrected
  to 20.19+ or 22.12+ (the floor Vite 8 and Next 16 set); the Rust test command skips the test
  that plays a tone through the speakers, as CI does; the Windows installer build command; a link
  to Issues.
- Supabase setup guide: turn off new-user sign-ups once your own account exists, because any
  account on the project can upload into the R2 bucket.

### Fixed
- Web and desktop: removing the last song from the queue now stops playback, as clearing the
  queue does, instead of leaving the removed song playing with no now-playing bar.
- Sync (core and Android): a change the server rejects no longer looks synced. The cycle used to
  clear the push error once the pull succeeded; it now ends in the error state ("Sync issue, will
  retry") until a later cycle pushes everything.
- Android sync recovers from an expired session instead of failing every request. A 401 (or
  PostgREST's "JWT expired") is no longer treated as a rejected op: the engine refreshes the
  session once and retries the cycle. If the refresh fails, the queue stays as it is (no retry
  count added) and the account menu shows "Sign in again to sync" with a Sign in button. While
  supabase-kt has no usable session it no longer sends requests with only the anon key; sync
  waits and resumes once the session is back. Web and desktop are unchanged.
- Web: phones showed two menu buttons in the top bar, and the player bar's shuffle, previous and
  repeat buttons below 640 px, because the icon button's own `inline-flex` outranked `hidden`.
  They now hide with `max-md:hidden` / `max-sm:hidden` (desktop: the mini player button below
  1280 px). The sidebar button's label now says Expand sidebar while it is collapsed.
- Web and desktop: the equalizer's band sliders have names ("31 Hz gain") and read their value
  in dB ("+3 dB"), and the preset list is named "Equalizer preset", for screen readers.
- `supabase/tests/vault_smoke.sql` edited `year`, which `apply_track_edit` rejects since 0006, so
  it failed; it now sets `release_date` and checks the derived year.
- docs/architecture.md: favorites and settings resolve on `edited_at` (not `updated_at`), and
  `release.yml` runs only by hand (not on tags); both now link to the documents that own them.
- Android search no longer shows "No songs here yet." under its own hint or no-results message.
- Android: a song in the auto-cache plays offline again. Playback asked the vault for a signed URL
  before looking in the cache, so without a connection a cached (not downloaded) song failed; the
  URL is now signed only when the cache has to fetch from the vault.
- Android: the last session's queue and position come back after a restart. The restore ran
  before the library had loaded and found none of its songs; it now waits for the library, and
  leaves alone a queue the user started meanwhile. The library also shows before the device
  check-in with the server, so it appears right away offline.
- Android equalizer: the ten band sliders no longer overlap. Each stands upright in its own column,
  with a handle narrow enough not to touch its neighbours.
- Android bottom bar: the highlighted tab follows the tab a page was opened in. An album opened
  from Library search stays under Library (it used to light up Collections), and tapping the
  active tab again goes back to its first page.
- Song lists and queue (Android, web and desktop): the current song shows a play icon while
  paused, instead of frozen bars that still looked like it was playing (for example after a song
  failed to load offline). The bouncing bars stay for playback.
- A song that can't be loaded now says so on every app: "<song>: Not available offline" when the
  device is offline, otherwise the reason. Android used to show nothing, desktop only logged it;
  preloading the next song stays quiet. Android: pressing play on a song that failed retries the
  load instead of showing "playing" at 0:00 with no sound.
- Listening history keeps every play (web, desktop and Android). The last song before closing the
  app, a killed process or a crash used to be lost, and repeat-one counted many plays as one.
  Each session now has a fixed event id and is saved every second while playing; it is recorded
  when the song ends, the track changes, the queue is cleared or the window closes, and a leftover
  is recorded at the next start (sent only to the account that played it). Recording a session
  twice still gives one event.
- Desktop: a download that fails part-way (dropped connection, disk error, bad hash) no longer
  leaves its half-written `.part` file behind, and leftovers from a crash are cleared at startup.
  Nothing tracked them, so they only took disk space.
- A download that fails now says so. Desktop and web show one message per run ("Tidal: download
  rejected (403)", or "Couldn't download 5 songs: Can't download while offline") instead of
  nothing (desktop) or one toast per song (web). Android keeps failed downloads in Downloads with
  the reason, Retry and Dismiss; it also removes the partial file of a failed download, and a
  queued download no longer fails as "no longer in your vault" when it runs before the library
  has loaded.
- Desktop: a downloaded or cached file that can't be deleted (in use, access denied) now stays in
  Downloads and in the space used, instead of vanishing from the list while staying on disk.
  Removing one says why it couldn't; the cache limit and the cleanup of deleted songs skip it and
  try again later.
- Web: pressing Download while a song is still streaming into the cache now keeps it as a
  download. It used to stay an evictable cache entry that could vanish before you went offline.
- Web and desktop dialogs (Upload, Edit details and every standard dialog) work from the keyboard
  and with screen readers: they are announced as named dialogs, focus moves into them (to the
  first field), Tab and Shift+Tab stay inside, the page behind is inert, Escape closes them where
  closing is allowed (Upload keeps uploading in the background), and focus returns to the button
  that opened them. Upload and Edit details had none of this; the others only closed on Escape.

### Security
- Vault `delete` only removes objects whose stored key is the caller's own and of the right kind
  (audio for `storage_key`, a full cover for `artwork_key`); any other key is logged and skipped.
  A user could set their own row's `artwork_key` to another user's cover with a direct update, and
  the service-role delete would then have removed that object. Live since the `vault` Edge
  Function was redeployed on 2026-10-20.
- Migration [0007_artwork_key_guard.sql](../supabase/migrations/0007_artwork_key_guard.sql)
  makes the database reject a direct client write of an `artwork_key` that is not the row owner's
  own full cover key. Applied to the live project on 2026-10-20.
- Signing out (and, on Android, switching accounts) no longer leaves the previous account's
  playback behind: the player stops and the queue, its saved resume point, cached signed links,
  queued downloads and loaded statistics are cleared. What belongs to the device stays: local
  listening history, downloaded and cached audio, and settings.

## [1.1.0] - 2026-10-15

Tagged `v1.1.0` at `21fdcd4`. Source only on the public repo, as with 1.0.0.

### Added
- Web: installable as an app (PWA): a manifest with regular and maskable icons, a service worker
  that keeps the app shell and build files so the installed app opens offline, and an
  "Install app" item in the account menu when the browser offers it.
- Android: a volume button at the right of the full player's second row opens a vertical slider
  that shows the percentage while you drag.
- Android: signed release APK. The key lives outside the repo; `local.properties` points at it
  (`signing.properties=…`), and without that line a release build comes out unsigned. Release
  builds no longer run R8.

### Changed
- Release builds (`release.yml`) run only when started by hand; releases with installers are built
  locally and attached to the private repo's release, so a pushed tag no longer triggers CI builds
  that would replace them.
- Docs and reports brought up to date with the 2026-10-13 to 2026-10-15 changes: removed features
  (star ratings, the accent picker, Duplicates, Android's drawer) no longer appear as current, test
  counts were recounted, and the new download, cache, statistics and UI features are documented.
- Web: the Help page describes the current downloads and themes.
- Version 1.1.0 in every manifest (Android: `versionName "1.1.0"`, `versionCode 2`).

## [1.0.0 public release] — owner feedback batch (2026-10-15)

The first public release, tagged `v1.0.0` on the public repo and exported from `4ff2cca`. The
version number had stayed at 1.0.0 since July, so this release holds every group from here down to
the July [1.0.0](#100--2026-07-17) entry.

### Added
- Public source repository `naimulnashid/music-vault`, a squashed export of this one, with
  LICENSE (MIT), SECURITY.md, CONTRIBUTING.md, a "Run your own" README section and a social
  preview. Releases there are source only: every build carries the Supabase project it was
  built for.

### Changed
- Android launcher icon now matches the desktop and web icon (violet gradient tile, white notes).
- A downloaded song is marked with a tick instead of a down arrow (all apps).
- Statistics heatmap covers the last 6 months (was 12), with month and weekday labels; cells grow
  on hover (desktop/web) or tap (Android). The Yearly recap button lost its sparkle icon.
- Upload: every song shows all its detail fields straight away; the "More details" toggle is gone.
- Album / artist / playlist Download button: shows how many songs are done and left while it runs;
  tapping it then cancels (queued and in-flight downloads stop), and once everything is downloaded a
  tap removes the downloads (all apps).
- Auto-cache limit is now Off, 1, 2, 5 or 10 GB (10 GB at most; Off keeps only the song playing and
  the next one), and the Downloads page has a Clear cache button (all apps; Android gained the
  auto-cache controls and applies a new limit without a restart).
- Player bar (desktop/web): a click anywhere on it outside the controls opens the full player; Lyrics
  (microphone), Sound (vertical sliders), Queue and Clear queue (broom) have distinct icons, and the
  bar's icons are a little larger. Android's full player uses the same distinct Sound and Clear
  queue icons.
- Every chart (activity, listening clock, heatmap, recap months) shares one hover tooltip, styled like
  the seek bar's: a dark surface in dark mode and a light one in light mode (desktop/web).
- Web: the account menu no longer has an "Account settings" item.
- Web: the address bar follows the page (/albums, /album/…, /artist/…, /playlist/…, /stats,
  /stats/history, /downloads…); reloading or sharing a link opens that page, and the browser's
  Back/Forward match the app's Back button.
- Playlist tiles show a bracketed qualifier's initial too: "Bangla (Bangladesh)" → B(B),
  "Bangla (India)" → B(I) (desktop/web).
- Android: the account menu drops down under the avatar at the top right, laid out like the desktop
  one (account, sync status with Sync now, Upload, appearance, Sign out) instead of a bottom sheet.
- Android: the upload page has one back arrow, with "Upload to your vault" in the top bar, and a
  larger "Add files" button in the middle of the empty page (centered above the list once files
  are added).
- Android: the Listening Activity chart's dates read 09-16, 09-23… again (they wrapped after the
  hyphen and showed only the month), and month ranges label every month, as on desktop/web.
- Android: heatmap month labels no longer run into the squares, and squares no longer grow on tap.
- Android: playlist covers in Collections (and a playlist's header) are a 2×2 mosaic of four
  distinct song covers, as on desktop/web; smart playlists use the songs their rules match.
- Collapsed sidebar (desktop/web) lists your playlists under the main icons; playlists without a
  cover show the first letter of their name instead of the sparkle icon.

### Added
- Statistics heatmap → Expand opens Listening History: every listening day since the first year
  with plays, in 6-month blocks on one colour scale (all apps).
- Web: "Download all songs automatically" too (while the site is open).
- Windows and Android: "Download all songs automatically" keeps every vault song on the device; songs
  added later download on their own, songs deleted from the vault are removed, and the auto-cache is
  bypassed while it is on.

## [1.0.0 public release] — new look and playback fixes (2026-10-13)

### Changed
- **Redesign of all three apps** (inspired by modern streaming apps): dark-first design tokens, one
  accent (Vibrant Violet `#8B5CF6`; accent presets and Material You accent removed), the Figtree
  typeface, and smooth transitions (Motion on desktop/web, Compose animations on Android).
- Desktop + web (same components): top bar with one search (songs, albums, artists; Ctrl+K or /)
  and Back; sidebar with collapsible icon rail and playlist covers; player bar with a seek line on
  its top edge; full-window Now Playing with a colour wash from the artwork and Up next / Lyrics /
  Details tabs; one song menu (row ⋮, right-click, player bar) with Play next / Add to queue;
  hero headers on album, artist, playlist and smart pages; card grids for By Genre/Year/Language;
  theme (Light/Dark/System, AMOLED) and notifications moved into the account menu.
- Android: bottom navigation (Library, Collections, Downloads, Stats) instead of the drawer;
  floating mini player (swipe left/right to change song, swipe up to open); full player with
  artwork pager (swipe to change song), drag down to close, swipe up for Up next / Lyrics;
  bottom-sheet song menu; collection headers; settings sheet (theme, AMOLED, account, upload).

### Added
- Android: live download progress — rings on song rows, overall and per-song bars on Downloads,
  and a progress notification; changing Wi-Fi/charging options re-queues waiting downloads.
- Desktop/web: download rings on song rows; "Play next" / "Add to queue" everywhere.
- Desktop: closing the window keeps Music Vault running in the tray (first time it says so);
  tray → Quit exits.

### Fixed
- Android: playback no longer stops on the lock screen, and the next song starts on its own —
  the media session is now registered with the playback service (media notification, lock-screen
  and headset controls, foreground service) and playback holds a Wi-Fi lock.
- Lyrics saved as LRC text in the plain-lyrics field now display synced instead of showing raw
  timestamps.

## [1.0.0 public release] — song details and fixes (2026-10-13)

### Removed
- **Star ratings** on all three apps (rows, Now Playing, menus) and the Rating field of the
  smart-rule builder; saved rules naming it count it as never set (golden fixture updated). The
  ratings table and sync pull path stay for older builds.

### Changed
- Song details: **Country** added after Language; **Year** replaced by **Release date** ("2019",
  "2019-05" or "2019-05-14"; `year` now follows it). Album artist, track number, disc number,
  composer and BPM are no longer edited, uploaded or shown. Supabase migration
  [0006_release_date_country.sql](../supabase/migrations/0006_release_date_country.sql).
- Desktop/web form fields no longer show a drop-down arrow, except Language and Country.
- Smart playlist rules: Album Artist, Composer, BPM, Track # and Disc # removed; **Country** added.
  A saved rule on a retired field counts it as never set (no crash).

### Added
- Android: a **Download** button on playlists (pins every track not yet on the device).

### Fixed
- Desktop/web smart playlist rules: typing in a value box no longer drops or reverts characters
  (edits are kept locally and saved after a short pause).

## [1.0.0 public release] — the vault (2026-10-11 → 2026-10-13)

Google Drive, local-folder libraries and local mode replaced by a private Cloudflare R2 vault —
steps M0–M8 of [docs/drive-to-r2-migration.md](../docs/drive-to-r2-migration.md). No version bump.

### Added
- **The vault**: a private R2 bucket (`users/<uid>/audio/<blake3>.<ext>`, covers by SHA-256 with a
  256 px thumbnail) and the **`vault` Edge Function** — `sign-get`, `sign-put`, `commit`, `delete`
  (`adb3772`). Setup guide [docs/vault-setup.md](../docs/vault-setup.md) (`589df7e`).
- **Supabase migration 0004**: vault columns on `tracks` (`storage_key`, `uploaded_at`,
  `artwork_key`, `field_edited_at`, `deleted_at`, `merged_into`), the protected-column trigger,
  and `apply_track_edit`, `resolve_upload_target`, `merge_tracks`, `delete_track` (`adb3772`).
- **Uploads from all three apps** — desktop files/folders/drag-and-drop (`5f95abd`), web picker and
  drag-and-drop (`d89476e`), Android picker and Share → Music Vault (`eda4cc8`) — with a review form,
  batch fields and a shared cover; known files are recognized by hash.
- **Details and covers edited online** from every app: the `track.edit` sync op with field-level
  last-writer-wins, pinned in SQL, TypeScript and Kotlin by `track-edit.golden.json` (`85cb73a`).
- **Delete from vault** from every app, behind a confirmation (`5f95abd`, `f935cf0`, `d89476e`,
  `eda4cc8`).
- **Verified downloads**: every download is checked against the track's BLAKE3; Android pinned
  downloads from the vault (`363b596`).

### Changed
- **The library is the vault** on every client: a projection of the synced `tracks` rows
  (`projectVault`, `projectRows`, `VaultMerge`) with ids `vault:<hash>` (desktop, Android).
- **Track identity is the content hash alone** — migration 0005 drops `drive_file_id` /
  `drive_md5` (`3799939`).
- **Fresh start**: the server was wiped and each client's library reset — desktop SQLite **v9**,
  Room **v7**, the web's `freshStart`; device settings kept (`d6f4d2e`, `bd3aaf6`, `6f2ad62`).
- An account is required; builds without Supabase values say so.

### Removed
- Google Drive on every client (OAuth, scanner, merge, `/api/drive/*`, token storage) and its
  environment variables and secrets; local-folder import and watching; the duplicates view; local
  mode (`bd3aaf6`, `6f2ad62`, `3799939`).

### Fixed
- Re-uploading a deleted track keeps the form's edits (applied after the commit revives the row),
  and downloaded copies of deleted tracks are removed (`5cc4888`).
- Android: startup crash when WorkManager was touched during Hilt injection (`6f2ad62`).

### Documentation
- Guides and reports rewritten for the vault; [VAULT.md](VAULT.md) replaces the Google Drive report
  and `docs/google-drive-setup.md` (M8, `9523e8d` …).

---

## [1.0.0 public release] — post-1.0

Work after the final phase commit (`36e11d8`, 2026-07-17). All of it lands on 2026-07-17.
No version bump accompanies these changes.

### Added
- **Desktop — "Sync to this device"**: mirrors Drive downloads to the local machine (`dc3ce6e`).
- **Desktop — live download telemetry**: per-file speed and an aggregate total in the Downloading
  section (`3e94b37`).
- **Desktop — Drive change detection**: files whose content changed (same `fileId`, new md5) are
  detected as stale and re-fetched, which re-extracts and re-publishes their metadata. Adds
  `cache_entries.source_md5` — **SQLite schema v7**, with a backfill so existing downloads get a
  baseline (`e8c0ef4`).
- **Desktop — cover art for cloud-only tracks**: art extracted at download time is recorded in a new
  `drive_artwork` table — **SQLite schema v8** — plus a startup backfill for files downloaded
  earlier. Art deliberately outlives both a Drive re-index and cache eviction (`e3b5237`).
- **UI — collapsible sidebar sections** and an account menu in the top bar (`8ff276c`).
- **Web — favicon**: the desktop app icon now serves as the web favicon (`cfe0b6b`).

### Changed
- **UI — account control** folded into each view's header; a 25-file refactor across desktop and
  web (`d441968`).
- **Desktop — download concurrency**: Drive files now download with **bounded concurrency** rather
  than unbounded parallelism (`b3b9c50`).

### Fixed
- **Queue clearing** — one bug, three commits, three clients: clearing the queue now also clears the
  saved resume point on desktop (`5423e5b`) and web (`f381eb5`), and a cleared queue propagates to
  other devices (`a1247c0`). Regression-tested by "an empty queue.set clears the handoff row and
  reaches the other device" ([syncEngine.test.ts:404](../packages/core/tests/syncEngine.test.ts)).
- **Desktop — startup crash**: jump-list initialization caused a black screen and auto-close on
  startup; a Phase 8c regression (`62a4e1b`).
- **Web — track language**: the folder-derived language is now preserved on synced cloud tracks
  (`3435a8d`).

### Documentation
- Android Drive setup gained the **Enable Custom URI Scheme** step, without which Google returns
  `Error 400: invalid_request` (`73c0e9e`).

---

## [1.0.0] — 2026-07-17

The complete ten-phase build ([PLAN.md](../PLAN.md) Phases 0–9). Full derivation:
[PHASE_PROGRESS.md](PHASE_PROGRESS.md).

### Phase 9 — Hardening & release · 2026-07-16 → 07-17

#### Added
- **Tests**: Rust cache-LRU suite (5 invariant tests) and Playwright web e2e — smoke always, signed-in
  flows behind `E2E_EMAIL`/`E2E_PASSWORD` (`c889289`).
- **Diagnostics**: sync-engine breadcrumbs on every client (`cycle.start`, `flush.coalesced`,
  `flush.conflictLost`, `pull.applied`, `enqueue.dropped`, …) plus an error/logging audit
  (`e2ea257`).
- **CI/CD**: GitHub Actions running every suite per push/PR, plus NSIS installer and APK builds on
  `v*` tags or manual dispatch (`8d811d5`).
- **Docs**: consolidated setup guide, public `/help` user docs on the web app, sync-protocol
  diagnostics section, README wrap-up (`36e11d8`).

#### Performance
- Virtualized track lists (50k-ready) via `useVirtualRows`, a 256px artwork thumbnail tier with
  startup backfill, lazy-loaded heavy web views, and startup profiling (`72363ae`).

### Phase 8 — Desktop polish & power features · 2026-07-16

#### Added
- **AMOLED theme**, custom accent color picker, follow-system-theme (`5cbe27f`).
- **Mini player**: an always-on-top frameless second webview with multiwindow support; the main
  window hides but keeps running as the "brain" (`a8404f0`).
- **System tray** with transport controls and **Windows jump lists** — both reuse the `smtc://control`
  channel so media keys, tray and taskbar share one dispatch path (`aac1468`).
- **ReplayGain playback stage** (track/album) in the Rust engine, applied per-stream so it stays
  correct across gapless splices; **APE and WavPack decoders** — the latter via vendored libwavpack
  C sources compiled by `build.rs`, needing no CMake or bindgen (`f8460da`).
- **Live folder watching** (`notify`, debounced) with roots persisted in a new `watched_folders`
  table — **SQLite schema v6** — and a content-hash **Duplicates view** (`a399c79`).

### Phase 7 — Statistics 2.0 · 2026-07-16

#### Added
- **Core stats engine**: play-event aggregation with golden fixtures (`9b6e498`).
- **Local play-event logs** on all three clients — desktop SQLite (**schema v5**), web IndexedDB
  (`mv-stats`), Android Room (**Room v6**) — each deliberately surviving sign-out, and each syncing
  as an append-only `playEvent.add` stream deduped by shared event id
  (`cc6d8ee`, `bcf3d48`, `4a66c95`).
- **Charts, calendar heatmap, streaks, listening clock, top lists** on all clients; a Wrapped-style
  **yearly recap** on desktop and web.

> ⚠️ Android's recap engine was ported but no screen was built for it — see
> [FEATURE_PARITY.md](FEATURE_PARITY.md).

### Phase 6 — Android cloud parity · 2026-07-15 → 07-16

#### Added
- **Kotlin sync-engine port**: fractional index, op envelope, LWW flush/pull, full test suite
  (`8c0ddd9`), wired into the app (`b74c358`). **Room v3** adds `sync_outbox`/`sync_cursors`/`sync_shadow`.
- **Google Drive on Android**: OAuth (AppAuth + custom scheme), scanner, library merge with cloud
  badge (`d1f6e58`). **Room v4** adds the Drive index.
- **Two-tier cache** (Media3 `SimpleCache` + a `downloads` table — **Room v5**), WorkManager
  downloads, hybrid play-through-cache (`f2455ee`).
- **Smart-rule builder UI** (`9cf0c0d`).
- **Material You dynamic color** + AMOLED theme (`d459f1e`).

### Phase 5 — Web app · 2026-07-15

#### Added
- **Next.js 16 rewrite**: App Router, Supabase SSR auth, the sync engine over IndexedDB, Drive
  downloads through an OPFS two-tier cache, Web Audio playback (`5d27bfb`).
- Web setup docs: env, Google Web OAuth client, Vercel deploy (`7e0788c`).

### Phase 4 — Sync engine · 2026-07-15

#### Added
- **The sync engine**: persisted outbox (survives crashes), LWW merge, fractional indexes, Supabase
  Realtime, cross-device queue handoff; spec in [docs/sync-protocol.md](../docs/sync-protocol.md)
  (`5ae7b45`). **SQLite v4**; **Supabase migration 0003**.

#### Changed
- **Deletions became soft state**: un-favoriting sets `favorite = false`; playlists and items gained
  `deleted_at` — because deletions are invisible to `updated_at` cursors.
- **Ratings widened from 1–5 to 0–5**, where 0 means "cleared".
- **`playlist_tracks` lost its FK to `tracks(id)`** on desktop, so synced playlists can reference
  cloud-only tracks that have no local row yet.
- Added `edited_at` (client LWW clock) alongside `updated_at` (server cursor clock), and
  `play_events.created_at` for server receive time.

### Phase 3 — Google Drive on desktop · 2026-07-14

#### Added
- **OAuth**: PKCE loopback flow with the refresh token in Windows Credential Manager (`b99db37`).
- **Scanner + library merge**: cloud tracks appear with a badge (`edae1ac`). **SQLite v3** adds
  `drive_files`, `drive_folders`, `cache_entries`.
- **Two-tier cache, hybrid playback, downloads UI, metadata push** to Supabase (`8ac57aa`).

#### Changed
- **Supabase migration 0002**: `tracks` unique indexes converted from partial to full, because
  PostgREST cannot infer partial unique indexes for upsert.

### Phase 2 — Metadata & track identity · 2026-07-14

#### Added
- Extended tags (album artist, track/disc number, composer, BPM, ReplayGain), **ratings**,
  **BLAKE3 content hashing**, and the shared **smart-rule engine** (TypeScript + Kotlin, pinned by
  golden fixtures) (`2fceaa8`). **SQLite v2**; **Room `MIGRATION_1_2`**.

### Phase 1 — Supabase foundation · 2026-07-14

#### Added
- **Migration 0001**: the full schema — 9 tables, RLS on every one, `set_updated_at()` and
  `handle_new_user()` triggers. `play_events` is append-only by construction (select + insert
  policies, no update/delete).
- Core Supabase module; sign-in/sign-up and device registration on desktop and Android (`6ca4171`).

### Phase 0 — Monorepo bootstrap · 2026-07-14

#### Added
- npm-workspaces monorepo; desktop and Android apps imported; shared `@musicvault/core` extracted
  and consumed by desktop; builds verified (`80edb55`).

---

## Schema version history

Useful when diagnosing an old install. Details in [DATABASE.md](DATABASE.md).

| Release | Desktop SQLite | Android Room | Supabase |
|---|---|---|---|
| Phase 0 | v1 | v1 | — |
| Phase 1 | v1 | v1 | 0001 |
| Phase 2 | v2 | v2 | 0001 |
| Phase 3 | v3 | v2 | 0002 |
| Phase 4 | v4 | v2 | 0003 |
| Phase 5 | v4 | v2 | 0003 |
| Phase 6 | v4 | v3 → v5 | 0003 |
| Phase 7 | v5 | v6 | 0003 |
| Phase 8 | v6 | v6 | 0003 |
| Phase 9 | v6 | v6 | 0003 |
| Post-1.0 | v8 | v6 | 0003 |
| Vault migration | **v9** (fresh start) | **v7** (fresh start) | **0005** |

---

## Notes on this changelog

- **Two version 1.0.0s.** No tags existed in July, so the July 1.0.0 boundary is drawn at
  `36e11d8`, the last commit that names a phase and the one that marks the README complete. The
  version number then stayed at 1.0.0 until the first public release on 2026-10-15, so that
  release (public tag `v1.0.0`, exported from `4ff2cca`) contains everything from the July entry
  up. Its sections are headed "1.0.0 public release".
- **Tags (checked 2026-10-15):** `v1.0.0` exists on the public repo only; `v1.1.0` (`21fdcd4`) is
  on both. Each public release's tree matches the private commit it was exported from.
  `release.yml` no longer runs on tags; it is started by hand.
- Phase commits carry their own summaries; this changelog compresses 32 phase commits into ten
  sections and lists the 13 post-1.0 commits by theme.
- Version numbers agree across manifests since 1.1.0: `1.1.0` in the JS, Rust and Tauri manifests
  and on Android (`versionName "1.1.0"`, `versionCode 2`). In July they disagreed (`1.0.0` vs
  Android's `"1.0"` / `versionCode 1`).
