# Music Vault — Android

The Android client of Music Vault. Fully native — Kotlin, Jetpack Compose, Media3/ExoPlayer, Room, Hilt — no WebView. Sign-in is required: the library lives in your account's vault ([../../reports/VAULT.md](../../reports/VAULT.md)).

## Features

- **Library**: every song in your vault, synced from Supabase. Add songs with **Upload music** in the account menu (the avatar, top right; system file picker) or **Share → Music Vault** from another app; each file is hashed (BLAKE3) and its details reviewed in a form before upload. Already-uploaded files are recognized.
- **Details, edited online**: title/artist/album/genre/language/country/release date/lyrics and the cover are edited from the track menu (one or several tracks) and sync to every device. Tags read at upload (JAudioTagger) only pre-fill the form; technical facts are read-only.
- **Delete from vault**: track menu or multi-select, after a confirmation; the song, its cover (if unused elsewhere) and its favorites, playlist entries and history go everywhere.
- **Downloads**: played songs are cached (Media3, LRU); **Download** pins a song for offline play (WorkManager, optional Wi-Fi-only), verified against its hash.
- **Lyrics**: synced lyrics auto-scroll with active-line highlight; plain lyrics fallback; active line shown on the Now Playing screen.
- **Playback**: play/pause/next/previous (restarts after 3 s), seek, queue with drag-reorder/remove/clear/jump, shuffle-on-start (tapped track first), repeat off/all/one.
- **Gapless & crossfade**: dual-ExoPlayer engine preloads the next track ~15 s ahead; gapless hard-switch or true overlap crossfade (0–12 s), same as the web audio engine.
- **Equalizer**: 10-band ±12 dB (31 Hz–16 kHz) via `DynamicsProcessing`, presets Flat / Bass Boost / Vocal / Treble Boost / Custom.
- **Visualizer**: spectrum bars + waveform modes (platform `Visualizer`; Android requires the mic permission to tap audio output — nothing is recorded).
- **Views**: All Tracks (search + sort by artist/album/title), Albums grid, Album page, Artist page, Playlists (create/rename/delete/reorder), Smart playlists (Recently Added/Played, Most Played, Favorites, Never Played), grouped browse (Genre/Artist/Year/Language), Statistics (listening time, tracks played, top artists/genres, most played).
- **Sync**: favorites, playlists, smart playlists, edits, play history, settings and the queue sync with desktop and web through the shared sync protocol (Kotlin port of the engine).
- **Persistence**: queue, playback position and settings survive restarts (Room + DataStore). Playback resumes paused at the saved position.
- **System integration**: MediaStyle notification, lock screen controls, Bluetooth/headset buttons, Android Auto browse tree (Tracks/Albums/Playlists/Favorites), audio-focus and becoming-noisy handling, sleep timer (15/30/45/60 min) that keeps counting in the background.
- **Theming**: light, dark or follow the system, plus pure-black AMOLED; one violet accent and the Figtree typeface, as on desktop and web.

## Building

Open the project folder in **Android Studio** (Ladybug or newer) and run — or from the command line:

```powershell
$env:JAVA_HOME = "$env:LOCALAPPDATA\MusicVaultBuild\jdk"   # any JDK 17 works
.\gradlew.bat :app:assembleDebug        # APK at app/build/outputs/apk/debug/
.\gradlew.bat testDebugUnitTest         # unit tests (queue, LRC, smart playlists…)
```

- SDK: compile/target 35, min 28 (Android 9+; required for the 10-band `DynamicsProcessing` EQ).
- `local.properties` points at `%LOCALAPPDATA%\Android\Sdk` and must hold `supabase.url` and `supabase.anonKey` ([../../reports/ENVIRONMENT_VARIABLES.md](../../reports/ENVIRONMENT_VARIABLES.md)).
- Emulator: start it with `-no-snapshot-load -no-snapshot-save`; a restored snapshot brings back an already-used session token and signs you out.

## Architecture

```
app/src/main/java/com/musicvault/
├─ domain/     Pure logic ported 1:1 from @musicvault/core (albums, smart rules,
│              stats, LRC parser, formatting) + models. Unit-tested.
├─ data/
│  ├─ cloud/   Supabase client + auth
│  ├─ db/      Room: playlists (+ordered junction), play_events, play_history,
│  │           queue_items, sync outbox/cursors/shadow, downloads
│  ├─ prefs/   DataStore settings (theme, EQ, volume, shuffle/repeat, crossfade…)
│  ├─ scanner/ JAudioTagger tag reading for uploads
│  ├─ sync/    Sync engine port, Supabase transport, track edits
│  ├─ vault/   vault function client, uploads, library projection, covers,
│  │           cache + pinned downloads
│  └─ repo/    Library / History / Stats repositories
├─ playback/   VaultPlayer (SimpleBasePlayer over two ExoPlayers: gapless + crossfade),
│              QueueState (pure, tested), EqController, PlaybackController,
│              PlaybackService (MediaLibraryService + Android Auto tree)
└─ ui/         Compose: top bar + account menu, bottom tabs, screens, mini player,
               Now Playing, bottom-sheet panels,
               vault/ (upload screen, track editor, share intake)
```

## Manual test checklist (on device)

1. **Upload**: avatar → Upload music → Add files → pick songs; review the details and upload. They appear in the library here and on desktop/web.
2. **Playback**: tap a track — it plays and the mini bar fills the queue from that list. Notification with artwork + transport appears; lock screen controls work.
3. **Background**: leave the app; playback continues. Swipe the app away while playing — playback should survive.
4. **Headset/Bluetooth**: play/pause/next from headphones or a BT device; unplugging pauses.
5. **Gapless/crossfade**: in the Sound panel, try gapless on an album with continuous tracks; set crossfade to ~6 s and let a track end.
6. **EQ**: switch to Bass Boost while playing — audible change; sliders set the preset to Custom.
7. **Restart**: force-stop the app, reopen — the queue and position are restored, paused.
8. **Sleep timer**: set 15 min from Now Playing; countdown shows; playback pauses at 0.
9. **Lyrics**: play a track with a matched `.lrc` — lines highlight and auto-scroll in sync.
10. **Visualizer**: open the visualizer, grant the mic permission — bars react; toggle waveform mode.
11. **Android Auto**: connect (or use Desktop Head Unit) — browse Tracks/Albums/Playlists/Favorites and play; tapping a song queues its whole list.
12. **Stats/history**: after some listening, Statistics shows listening time, top artists/genres, most played.
13. **Edit & delete**: edit a song's details on the phone — the change shows on desktop/web; delete one from the vault — it disappears everywhere.

## Platform differences vs. the web app (by design)

- Songs come in through the system picker or the share sheet; there is no drag-and-drop or whole-folder upload.
- The web "background tab notification" toggle is replaced by Android's persistent media notification (always shown while playing — an OS requirement).
- The Queue/Sound/Lyrics/Visualizer side panels open as bottom sheets.
- Keyboard shortcuts map to hardware media keys / headset / Bluetooth buttons.
- The visualizer needs the microphone permission (Android gates output capture behind it).
