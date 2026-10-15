import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Music Vault — Help",
  description: "How to use Music Vault on desktop, Android and the web.",
};

/**
 * Public user docs (listed in isPublic in src/proxy.ts). Static server
 * component — no stores, no client JS.
 */

function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold mt-10 mb-3">{children}</h2>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-muted mb-3">{children}</p>;
}

function Li({ children }: { children: ReactNode }) {
  return <li className="text-sm leading-6 text-muted">{children}</li>;
}

export default function HelpPage() {
  return (
    <main className="min-h-screen">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-semibold mb-2">Music Vault Help</h1>
        <P>
          One library, three players: the Windows desktop app, the Android app and this
          website share your account, playlists, favorites, queue and listening
          history. Your songs live in your private vault in the cloud; every device
          downloads a track once and keeps it.
        </P>
        <p className="text-sm">
          <Link href="/login" className="text-accent hover:underline">
            ← Back to sign in
          </Link>
        </p>

        <H2>Getting started</H2>
        <ul className="list-disc pl-5 space-y-1 mb-3">
          <Li>Create an account (or sign in) — the same email/password works on every device.</Li>
          <Li>
            Upload songs from any device: the upload button on desktop and web (or drop files
            onto the window), or “Share → Music Vault” and the upload button on Android.
          </Li>
          <Li>
            Before anything uploads you review each song&apos;s details — title, artist, album,
            genre, language, country, release date, cover and more. The file&apos;s tags only pre-fill the form.
          </Li>
          <Li>
            Details live online: edit them any time (one track or several at once) and the change
            reaches every device.
          </Li>
        </ul>

        <H2>Playback</H2>
        <P>
          Click any track to play it and queue what follows. The queue panel (right side)
          shows and reorders what is coming. Gapless playback and crossfade are in settings;
          the equalizer, lyrics and visualizer live in the panels next to the queue. Desktop
          adds ReplayGain volume leveling (track or album mode) and hi-res output.
        </P>

        <H2>Cloud tracks, downloads &amp; offline</H2>
        <P>
          Every track lives in your vault and downloads automatically on first play into a
          size-capped cache (Off up to 10 GB, with a Clear cache button). Use Download on a song,
          album, artist or playlist to <em>pin</em> it for offline use: the button shows how many
          songs are done while it runs, a click cancels, and once everything is here a click
          removes the downloads. A tick marks a downloaded song. “Download all songs
          automatically” in the Downloads view keeps your whole vault on the device (in a browser,
          while Music Vault is open).
        </P>

        <H2>Playlists &amp; smart playlists</H2>
        <ul className="list-disc pl-5 space-y-1 mb-3">
          <Li>Create playlists from the sidebar “+”; drag tracks to reorder.</Li>
          <Li>
            Smart playlists (✨) fill themselves from rules — genre, artist, language, play
            count, last-played and more, with AND/OR groups. Edit rules any time.
          </Li>
          <Li>Everything syncs: edits made offline merge when you reconnect.</Li>
        </ul>

        <H2>Favorites &amp; statistics</H2>
        <P>
          The heart on every song marks a favorite and feeds smart playlists. The Statistics
          view charts your listening over any range — activity, calendar heatmap, streaks,
          listening clock, top artists/albums/tracks — and the yearly Recap wraps it up.
          Every device records full listening history and syncs it.
        </P>

        <H2>Desktop extras</H2>
        <ul className="list-disc pl-5 space-y-1 mb-3">
          <Li>Mini player: a small always-on-top window; the tray icon has transport controls.</Li>
          <Li>Media keys and the Windows media overlay work out of the box.</Li>
          <Li>Themes: light, dark or follow the system, plus a pure-black AMOLED mode.</Li>
          <Li>Sleep timer and synced lyrics (add an .lrc file when you upload a song).</Li>
        </ul>

        <H2>Sync — how it behaves</H2>
        <P>
          Edits queue locally and push in the background; the account panel shows the sync
          state. Offline edits never get lost — they flush on reconnect, and if two devices
          edited the same thing, the newest edit wins. Your play queue follows you: a fresh
          device offers to resume where another left off.
        </P>

        <H2>Troubleshooting</H2>
        <ul className="list-disc pl-5 space-y-1 mb-3">
          <Li>Sync looks stuck: check the status in the account panel — “offline” clears on reconnect.</Li>
          <Li>
            A track will not play: make sure you are signed in and online for its first play
            (after that it plays from this device), and that it wasn&apos;t deleted from the vault
            on another device.
          </Li>
          <Li>
            Desktop logs live in <code>%APPDATA%/com.musicvault.app/logs</code> — include the
            newest file when reporting a problem (sync activity is recorded there too).
          </Li>
          <Li>No cover on a track: add one with “Edit details” — covers are stored online too.</Li>
        </ul>
      </div>
    </main>
  );
}
