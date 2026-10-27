import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import {
  backupCopyArt,
  backupWriteText,
  syncShadowAll,
  vaultMirrorApply,
  vaultMirrorDir,
  vaultMirrorPlan,
  vaultMirrorRemove,
  vaultMirrorSetDir,
  type MirrorTrack,
  type MirrorWork,
} from "../lib/ipc";
import { fetchVaultArt, signedUrls } from "../lib/vault";
import { emitAppError } from "../lib/errorBus";
import {
  coverFileName,
  mirrorTracks,
  runSummary,
  safeFileName,
  spaceShortfall,
  tombstonedIds,
  type MirrorRunResult,
} from "../lib/mirror";
import { supabase } from "../lib/supabase";
import { useLibraryStore } from "./libraryStore";
import { useSyncStore } from "./syncStore";
import { useAuthStore } from "./authStore";
import { useArtistPhotoStore } from "./artistPhotoStore";
import { useCollectionCoverStore } from "./collectionCoverStore";

/**
 * Backup Music Vault (vault/backup.rs, vault/mirror.rs): keeps a folder on
 * this PC holding every song as a tagged file, every cover and artist photo,
 * and the account's database rows, so the library can be rebuilt without
 * Supabase or R2. A run starts a little after the library changes, once this
 * session's first pull is in, and writes only what changed.
 */

/** Songs written at once: each is a download or copy plus a full-file rewrite. */
const CONCURRENCY = 2;
/** Links are signed this many songs (or pictures) at a time, each batch just before it runs. */
const SIGN_BATCH = 50;
/** Edits and pulls arrive in bursts; one run follows them. */
const RUN_DELAY_MS = 5000;

export type BackupPhase = "music" | "covers" | "database";

interface BackupStoreState {
  /** The backup folder while backups are on. */
  dir: string | null;
  running: { phase: BackupPhase; done: number; total: number } | null;
  /** The last run's outcome, for the card. */
  summary: string | null;
  /** Why the last run couldn't start or stopped (an unplugged drive, no space). */
  problem: string | null;
  /** When this session's last complete run finished. */
  lastRun: number | null;
  init: () => Promise<void>;
  chooseDir: () => Promise<void>;
  turnOff: () => Promise<void>;
  runNow: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let runAgain = false;
/** Bumped by turning off and signing out; a run that sees it change stops. */
let generation = 0;

function scheduleRun(delay = RUN_DELAY_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void useBackupStore.getState().runNow();
  }, delay);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useBackupStore = create<BackupStoreState>((set, get) => ({
  dir: null,
  running: null,
  summary: null,
  problem: null,
  lastRun: null,

  init: async () => {
    try {
      set({ dir: await vaultMirrorDir() });
    } catch (err) {
      console.error("[backup] reading the folder failed:", err);
    }
    useLibraryStore.subscribe((s, prev) => {
      if (s.vaultRows !== prev.vaultRows || s.pendingEdits !== prev.pendingEdits) scheduleRun();
    });
    useArtistPhotoStore.subscribe((s, prev) => {
      if (s.photos !== prev.photos) scheduleRun();
    });
    useCollectionCoverStore.subscribe((s, prev) => {
      if (s.covers !== prev.covers) scheduleRun();
    });
    useSyncStore.subscribe((s, prev) => {
      if (s.initialPullDone && !prev.initialPullDone) scheduleRun(0);
      if (!s.initialPullDone && prev.initialPullDone) generation++; // signed out or switched account
    });
  },

  chooseDir: async () => {
    const picked = await open({ directory: true, title: "Choose a folder for the Music Vault backup", defaultPath: get().dir ?? undefined });
    if (typeof picked !== "string") return;
    generation++;
    try {
      await vaultMirrorSetDir(picked);
      set({ dir: picked, summary: null, problem: null, lastRun: null });
      scheduleRun(0);
    } catch (err) {
      emitAppError(`Couldn't use that folder for the backup: ${message(err)}`);
    }
  },

  turnOff: async () => {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      await vaultMirrorSetDir(null);
      set({ dir: null, summary: null, problem: null, lastRun: null });
    } catch (err) {
      emitAppError(`Couldn't turn off backups: ${message(err)}`);
    }
  },

  runNow: async () => {
    if (get().running) {
      runAgain = true;
      return;
    }
    const account = useAuthStore.getState().session?.user.id;
    if (!get().dir || !account || !useSyncStore.getState().initialPullDone) return;
    const run = generation;
    const stopped = () => run !== generation;
    set({ running: { phase: "music", done: 0, total: 0 }, problem: null });
    try {
      const { vaultRows, pendingEdits } = useLibraryStore.getState();
      const tracks = mirrorTracks(vaultRows, pendingEdits);
      const plan = await vaultMirrorPlan(account, tracks, tombstonedIds(vaultRows));
      if (plan.removed.length > 0) await vaultMirrorRemove(plan.removed);
      const shortfall = spaceShortfall(plan.bytesNeeded, plan.freeBytes);
      if (shortfall) {
        set({ problem: shortfall });
        return;
      }
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const keyById = new Map(vaultRows.map((r) => [r.id, r.storage_key]));
      const result: MirrorRunResult = { total: plan.upToDate, failed: 0, untagged: plan.untagged, firstError: null };
      set({ running: { phase: "music", done: 0, total: plan.work.length } });
      for (let start = 0; start < plan.work.length && !stopped(); start += SIGN_BATCH) {
        const batch = plan.work.slice(start, start + SIGN_BATCH);
        await prepareBatch(batch, byId, keyById);
        let cursor = 0;
        const worker = async () => {
          while (cursor < batch.length && !stopped()) {
            const item = batch[cursor++];
            const track = byId.get(item.id)!;
            try {
              const key = keyById.get(item.id);
              if (item.needsAudio && !key) throw new Error("this song is no longer in the vault");
              const url = item.needsAudio && key ? ((await signedUrls()?.getOne(key)) ?? null) : null;
              const { tagged } = await vaultMirrorApply(track, item.relPath, url);
              result.total++;
              if (!tagged) result.untagged++;
            } catch (err) {
              result.failed++;
              result.firstError ??= message(err);
              console.error("[backup] writing a song failed:", track.title, err);
            }
            set((s) => ({ running: s.running && { ...s.running, done: s.running.done + 1 } }));
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
      }
      if (stopped()) return;

      const art = await backupArtwork(tracks, (done, total) => set({ running: { phase: "covers", done, total } }), stopped);
      if (stopped()) return;

      set({ running: { phase: "database", done: 0, total: 0 } });
      const tables = await backupDatabase();
      await backupWriteText(
        "Backup info.json",
        JSON.stringify(
          {
            app: "Music Vault",
            format: 1,
            finishedAt: new Date().toISOString(),
            songs: result.total,
            songsNotWritten: result.failed,
            covers: art.covers,
            artistPhotos: art.photos,
            tables,
            layout: {
              Music: "every song as a tagged file, Artist/Album/Title.ext, synced lyrics as .lrc beside it",
              Covers: "every cover at full size, <sha256>.jpg, named as in the artwork keys in Database/tracks.json",
              "Artist photos": "the photos picked for artists, <artist>.jpg",
              Database: "the account's rows as of the last sync, one JSON array per table",
            },
          },
          null,
          2,
        ),
      );
      const missing = art.missing > 0 ? ` • ${art.missing} ${art.missing === 1 ? "picture" : "pictures"} couldn't be fetched` : "";
      set({
        summary: `${runSummary(result)} • ${art.covers} covers and ${art.photos} artist photos • database saved${missing}`,
        lastRun: Date.now(),
      });
    } catch (err) {
      if (!stopped()) set({ problem: message(err) });
      console.error("[backup] run failed:", err);
    } finally {
      set({ running: null });
      if (runAgain && !stopped()) scheduleRun(0);
      runAgain = false;
    }
  },
}));

/**
 * Before a batch runs: its covers into the artwork cache (Rust reads them
 * there) and its audio links signed together, so each song's link is a cache hit.
 */
async function prepareBatch(
  batch: MirrorWork[],
  byId: Map<string, MirrorTrack>,
  keyById: Map<string, string | null>,
): Promise<void> {
  const covers = batch.map((w) => byId.get(w.id)?.artworkKey).filter((k): k is string => Boolean(k));
  if (covers.length > 0) await fetchVaultArt(covers);
  const audio = batch
    .filter((w) => w.needsAudio)
    .map((w) => keyById.get(w.id))
    .filter((k): k is string => Boolean(k));
  if (audio.length > 0) await signedUrls()?.get(audio);
}

/**
 * Every live song's cover, every picked playlist cover and every artist photo
 * into the backup folder, fetched into the artwork cache first where this PC
 * doesn't have them yet. Copies are skipped when already there.
 */
async function backupArtwork(
  tracks: MirrorTrack[],
  progress: (done: number, total: number) => void,
  stopped: () => boolean,
): Promise<{ covers: number; photos: number; missing: number }> {
  const photos = Object.entries(useArtistPhotoStore.getState().photos);
  const picked = Object.values(useCollectionCoverStore.getState().covers);
  const coverKeys = [...new Set([...tracks.map((t) => t.artworkKey), ...picked].filter((k): k is string => Boolean(k)))];
  const wanted = [...new Set([...coverKeys, ...photos.map(([, key]) => key)])];
  const files: Record<string, string> = {};
  for (let start = 0; start < wanted.length && !stopped(); start += SIGN_BATCH) {
    Object.assign(files, await fetchVaultArt(wanted.slice(start, start + SIGN_BATCH)));
    progress(Math.min(start + SIGN_BATCH, wanted.length), wanted.length);
  }
  let covers = 0;
  let written = 0;
  let missing = 0;
  for (const key of coverKeys) {
    if (stopped()) break;
    if (!files[key]) {
      missing++;
      continue;
    }
    await backupCopyArt(files[key], `Covers/${coverFileName(key)}`);
    covers++;
  }
  for (const [artist, key] of photos) {
    if (stopped()) break;
    if (!files[key]) {
      missing++;
      continue;
    }
    await backupCopyArt(files[key], `Artist photos/${safeFileName(artist, "artist")}.jpg`);
    written++;
  }
  return { covers, photos: written, missing };
}

/** Shadow tables, each written as one JSON array of its rows. */
const TABLES = ["tracks", "playlists", "favorites", "ratings", "play_events", "settings", "queue"];

/**
 * The account's rows as this PC last synced them, read from the sync shadow
 * (no download), plus the device list. Returns the row count per table.
 */
async function backupDatabase(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const rowsOf = async (entity: string) => (await syncShadowAll(entity)).map(({ payload }) => JSON.parse(payload) as unknown);
  const write = async (name: string, rows: unknown[]) => {
    await backupWriteText(`Database/${name}.json`, JSON.stringify(rows, null, 1));
    counts[name] = rows.length;
  };
  for (const table of TABLES) await write(table, await rowsOf(table));
  // The shadow keeps playlist items per playlist.
  const items: unknown[] = [];
  for (const playlist of (await rowsOf("playlists")) as { id: string }[]) {
    items.push(...(await rowsOf(`playlist_items/${playlist.id}`)));
  }
  await write("playlist_items", items);
  // Devices aren't synced; the table is small and holds nothing else.
  if (supabase && useAuthStore.getState().session) {
    const { data } = await supabase.from("devices").select("id, name, platform, created_at, last_seen_at");
    if (data) await write("devices", data);
  }
  return counts;
}
