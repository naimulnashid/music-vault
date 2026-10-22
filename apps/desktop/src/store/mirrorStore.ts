import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import {
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
import { mirrorTracks, runSummary, spaceShortfall, tombstonedIds, type MirrorRunResult } from "../lib/mirror";
import { useLibraryStore } from "./libraryStore";
import { useSyncStore } from "./syncStore";
import { useAuthStore } from "./authStore";

/**
 * The library mirror (vault/mirror.rs): keeps a folder of plain, tagged music
 * files in step with the vault. A run starts a little after the library
 * changes, once this session's first pull is in, and writes only what changed.
 */

/** Songs written at once: each is a download or copy plus a full-file rewrite. */
const CONCURRENCY = 2;
/** Links are signed this many songs at a time, each batch just before it runs. */
const SIGN_BATCH = 50;
/** Edits and pulls arrive in bursts; one run follows them. */
const RUN_DELAY_MS = 5000;

interface MirrorStoreState {
  /** The mirror folder while the mirror is on. */
  dir: string | null;
  running: { done: number; total: number } | null;
  /** The last run's outcome, for the card. */
  summary: string | null;
  /** Why the last run couldn't start or stopped (an unplugged drive, no space). */
  problem: string | null;
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
    void useMirrorStore.getState().runNow();
  }, delay);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useMirrorStore = create<MirrorStoreState>((set, get) => ({
  dir: null,
  running: null,
  summary: null,
  problem: null,

  init: async () => {
    try {
      set({ dir: await vaultMirrorDir() });
    } catch (err) {
      console.error("[mirror] reading the folder failed:", err);
    }
    useLibraryStore.subscribe((s, prev) => {
      if (s.vaultRows !== prev.vaultRows || s.pendingEdits !== prev.pendingEdits) scheduleRun();
    });
    useSyncStore.subscribe((s, prev) => {
      if (s.initialPullDone && !prev.initialPullDone) scheduleRun(0);
      if (!s.initialPullDone && prev.initialPullDone) generation++; // signed out or switched account
    });
  },

  chooseDir: async () => {
    const picked = await open({ directory: true, title: "Choose a folder for the library mirror", defaultPath: get().dir ?? undefined });
    if (typeof picked !== "string") return;
    generation++;
    try {
      await vaultMirrorSetDir(picked);
      set({ dir: picked, summary: null, problem: null });
      scheduleRun(0);
    } catch (err) {
      emitAppError(`Couldn't use that folder for the library mirror: ${message(err)}`);
    }
  },

  turnOff: async () => {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      await vaultMirrorSetDir(null);
      set({ dir: null, summary: null, problem: null });
    } catch (err) {
      emitAppError(`Couldn't turn off the library mirror: ${message(err)}`);
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
    set({ running: { done: 0, total: 0 }, problem: null });
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
      set({ running: { done: 0, total: plan.work.length } });
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
              console.error("[mirror] writing failed:", track.title, err);
            }
            set((s) => ({ running: s.running && { ...s.running, done: s.running.done + 1 } }));
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
      }
      if (!stopped()) set({ summary: runSummary(result) });
    } catch (err) {
      if (!stopped()) set({ problem: message(err) });
      console.error("[mirror] run failed:", err);
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
