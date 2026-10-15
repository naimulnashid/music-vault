import { emptySmartRules, type StatsEvent } from "@musicvault/core";
import type { Playlist, Track } from "../types";
import { addPlayEvent, allPlayEvents } from "./playEventLog";
import { audioPut, putArtwork } from "./db";
import { useLibraryStore } from "../store/libraryStore";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { useDownloadStore } from "../store/downloadStore";

/**
 * Screenshot demo: an invented library for the README's screenshots, so no
 * real song, cover or listening history is ever published.
 *
 * Only a build made with NEXT_PUBLIC_MV_DEMO=1 and no Supabase settings runs
 * it (`npm run demo:shots -w music-vault-web`); in every other build `DEMO` is
 * false and this module is dead code. Artists, albums and titles are made up,
 * covers are drawn from a fixed seed, and the play history is generated, so
 * every capture shows the same thing.
 */
export const DEMO = process.env.NEXT_PUBLIC_MV_DEMO === "1";

interface DemoAlbum {
  artist: string;
  album: string;
  genre: string;
  language: string;
  country: string;
  releaseDate: string;
  colors: [string, string];
  titles: string[];
}

const ALBUMS: DemoAlbum[] = [
  { artist: "Northbound Lights", album: "Paper Lanterns", genre: "Indie Pop", language: "English", country: "Canada", releaseDate: "2021-04-16", colors: ["#f59e0b", "#db2777"], titles: ["Paper Lanterns", "Summer in Reverse", "Glass Harbour", "Kite Season", "Small Hours"] },
  { artist: "Mira Sol", album: "Saltwater Hours", genre: "Electronic", language: "English", country: "Portugal", releaseDate: "2023-02-03", colors: ["#22d3ee", "#4f46e5"], titles: ["Saltwater Hours", "Tidal", "Blue Room", "Afterglow Drive", "Coastline", "Static Bloom"] },
  { artist: "The Quiet Harbour", album: "Low Tide Letters", genre: "Folk", language: "English", country: "Ireland", releaseDate: "2019-09-27", colors: ["#a3e635", "#0f766e"], titles: ["Low Tide Letters", "Rowan Street", "Lamplight", "The Long Way Home", "Weathervane"] },
  { artist: "Arjo Rahman", album: "Megher Chithi", genre: "Rock", language: "Bangla", country: "Bangladesh", releaseDate: "2020-06-12", colors: ["#fb7185", "#7c2d12"], titles: ["Megher Chithi", "Nodir Opare", "Shohor", "Brishti Rater Gaan", "Alo"] },
  { artist: "Kavya Rao", album: "Saawan Notes", genre: "Pop", language: "Hindi", country: "India", releaseDate: "2022-07-22", colors: ["#c084fc", "#be185d"], titles: ["Saawan", "Raat Ki Baat", "Khidki", "Chai Aur Baarish", "Safar"] },
  { artist: "Lumen Drift", album: "Glass Orbit", genre: "Ambient", language: "Instrumental", country: "Norway", releaseDate: "2024-01-19", colors: ["#93c5fd", "#1e1b4b"], titles: ["Glass Orbit", "Aurora Field", "Slow Satellite", "Polar Night", "Driftwood"] },
  { artist: "Velvet Static", album: "Night Bus Radio", genre: "Synthwave", language: "English", country: "United Kingdom", releaseDate: "2022-11-04", colors: ["#f472b6", "#312e81"], titles: ["Night Bus Radio", "Neon Rain", "Last Train Out", "Overpass", "Midnight Mile"] },
  { artist: "Ana Ferreira", album: "Casa Azul", genre: "Bossa Nova", language: "Portuguese", country: "Brazil", releaseDate: "2018-03-09", colors: ["#2dd4bf", "#1d4ed8"], titles: ["Casa Azul", "Manhã de Sal", "Varanda", "Samba Lento", "Céu de Abril"] },
];

/** Park–Miller: the same sequence on every run. */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** An abstract square cover: a gradient with soft shapes and rings. */
async function drawCover(colors: [string, string], seed: number): Promise<Blob> {
  const rand = seeded(seed);
  const size = 512;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.globalAlpha = 0.08 + rand() * 0.18;
    ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";
    ctx.arc(rand() * size, rand() * size, 40 + rand() * 180, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  const cx = size * (0.3 + rand() * 0.4);
  const cy = size * (0.3 + rand() * 0.4);
  for (let r = 30; r < 260; r += 28 + rand() * 20) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
}

/** Silent 8 kHz mono WAV, so a loaded song resolves locally instead of erroring. */
function silentWav(seconds: number): Blob {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128);
  return new Blob([buf], { type: "audio/wav" });
}

async function writeAudio(track: Track, seconds: number, tier: "pin" | "cache"): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("audio", { create: true });
  const file = await dir.getFileHandle(track.id, { create: true });
  const w = await file.createWritable();
  await w.write(silentWav(seconds));
  await w.close();
  const now = Date.now();
  await audioPut({ trackId: track.id, fileName: track.id, tier, size: track.fileSize, addedAt: now, lastPlayedAt: now });
}

export async function loadDemo(): Promise<void> {
  const rand = seeded(42);
  const now = Date.now();
  const tracks: Track[] = [];
  ALBUMS.forEach((a, ai) => {
    a.titles.forEach((title, ti) => {
      const duration = Math.round(150 + rand() * 180);
      tracks.push({
        id: `demo-${ai}-${ti}`,
        fileName: `${title}.flac`,
        fileSize: Math.round(duration * 110_000),
        title,
        artist: a.artist,
        album: a.album,
        genre: a.genre,
        language: a.language,
        country: a.country,
        releaseDate: a.releaseDate,
        year: Number(a.releaseDate.slice(0, 4)),
        duration,
        sampleRate: 44100,
        codec: "FLAC",
        addedAt: now - (ALBUMS.length - ai) * 9 * 86_400_000 - ti * 60_000,
        favorite: rand() < 0.25,
        storageKey: undefined,
      });
    });
  });

  const byId = new Map(tracks.map((t) => [t.id, t]));
  const pick = (ids: string[]) => ids.filter((id) => byId.has(id));
  const playlists: Playlist[] = [
    { id: "demo-pl-1", name: "Road Trip", createdAt: now - 40 * 86_400_000, trackIds: pick(["demo-0-1", "demo-6-1", "demo-3-0", "demo-1-3", "demo-7-3", "demo-4-1", "demo-6-4"]) },
    { id: "demo-pl-2", name: "Late Night Focus", createdAt: now - 20 * 86_400_000, trackIds: pick(["demo-5-0", "demo-1-2", "demo-5-2", "demo-2-2", "demo-5-3", "demo-7-0"]) },
    {
      id: "demo-pl-3",
      name: "Bangla",
      createdAt: now - 10 * 86_400_000,
      trackIds: [],
      isSmart: true,
      smartRules: { ...emptySmartRules(), root: { combinator: "and", rules: [{ field: "language", op: "is", value: "Bangla" }] } },
    },
  ];

  // Covers: one per album, stored the way downloaded artwork is.
  for (const [ai, a] of ALBUMS.entries()) {
    const blob = await drawCover(a.colors, 1000 + ai * 37);
    for (const t of tracks.filter((x) => x.album === a.album)) await putArtwork(t.id, blob);
  }

  // A few downloads, so ticks and the Downloads page have something to show.
  const pinned = ["demo-0-0", "demo-0-1", "demo-1-0", "demo-1-3", "demo-3-0", "demo-5-0", "demo-6-1"];
  for (const id of pinned) await writeAudio(byId.get(id)!, 1, "pin");
  const current = byId.get("demo-1-0")!;
  await writeAudio(current, current.duration, "pin");

  // Six months and a bit of listening, mostly evenings, a little every morning.
  if ((await allPlayEvents()).length === 0) {
    const events = seeded(7);
    const pending: Promise<void>[] = [];
    for (let day = 200; day >= 0; day--) {
      if (events() < 0.35) continue;
      const plays = 2 + Math.floor(events() * 12);
      for (let p = 0; p < plays; p++) {
        const hour = events() < 0.65 ? 18 + Math.floor(events() * 5) : 7 + Math.floor(events() * 3);
        const t = tracks[Math.floor(Math.pow(events(), 1.7) * tracks.length)];
        const heard = t.duration * (0.55 + events() * 0.45);
        const start = new Date(now - day * 86_400_000);
        start.setHours(hour, Math.floor(events() * 60), 0, 0);
        if (start.getTime() > now) continue;
        const event: StatsEvent = {
          id: `demo-ev-${day}-${p}`,
          trackId: t.id,
          playedAt: start.getTime(),
          durationPlayed: Math.round(heard),
          completed: heard >= t.duration * 0.9,
        };
        pending.push(addPlayEvent(event));
      }
    }
    await Promise.all(pending);
  }

  useLibraryStore.getState().setLibrary(tracks, playlists);
  await useDownloadStore.getState().refreshDownloads();
  // A stand-in account, so the avatar shows an initial instead of "not configured".
  useAuthStore.setState({
    status: "signedIn",
    session: { user: { id: "demo", email: "you@example.com" } } as never,
  });
  const queue = [current, ...tracks.filter((t) => t.album === current.album && t.id !== current.id), byId.get("demo-6-0")!];
  usePlayerStore.getState().restoreQueue(queue, 0, 74);
}
