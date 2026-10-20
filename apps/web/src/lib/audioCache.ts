import { parseBlob } from "music-metadata";
import { createBLAKE3 } from "hash-wasm";
import type { Track } from "../types";
import { signedUrls } from "./vault";
import {
  audioAll,
  audioDelete,
  audioGet,
  audioPut,
  putArtwork,
  type AudioEntry,
  type AudioTier,
} from "./db";
import { invalidateArtwork } from "./artwork";

/**
 * Two-tier audio storage in OPFS (same model as desktop, Phase 3c):
 *
 *  1. auto-cache — created by playing a non-local track; LRU-evicted under a
 *     configurable byte cap. Never evicts tier 2.
 *  2. pinned downloads — explicit "Download" actions; permanent until removed.
 *
 * Bookkeeping rows live in IndexedDB (lib/db.ts "audio" store); the bytes live
 * in OPFS under /audio/<trackId>. A track is never downloaded twice.
 */

const CACHE_MAX_KEY = "mv.cacheMaxBytes";
export const DEFAULT_CACHE_MAX_BYTES = 4 * 1024 ** 3;
/** Largest allowed cap; 0 turns the auto-cache off. */
export const MAX_CACHE_MAX_BYTES = 10 * 1024 ** 3;
/**
 * The most recently played cached songs are never evicted: the one playing
 * and the one preloaded after it must keep their bytes, even with the cache off.
 */
const KEEP_RECENT = 2;

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export function getCacheMaxBytes(): number {
  try {
    const raw = localStorage.getItem(CACHE_MAX_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_CACHE_MAX_BYTES) : DEFAULT_CACHE_MAX_BYTES;
  } catch {
    return DEFAULT_CACHE_MAX_BYTES;
  }
}

export function setCacheMaxBytes(bytes: number): void {
  try {
    localStorage.setItem(CACHE_MAX_KEY, String(bytes));
  } catch {
    // Ignore.
  }
}

export function opfsSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.storage?.getDirectory);
}

async function audioDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("audio", { create: true });
}

async function readFile(fileName: string): Promise<Blob | null> {
  try {
    const dir = await audioDir();
    const handle = await dir.getFileHandle(fileName);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function deleteFile(fileName: string): Promise<void> {
  try {
    const dir = await audioDir();
    await dir.removeEntry(fileName);
  } catch {
    // Already gone.
  }
}

/** Local bytes for a track, or null. Touches lastPlayedAt on hit. */
/** Whether a cached copy holds the audio this track plays now. */
function entryMatches(entry: AudioEntry, track: Track): boolean {
  return !(track.storageKey && track.contentHash) || entry.contentHash === track.contentHash;
}

export async function getLocalAudio(track: Track): Promise<Blob | null> {
  if (!opfsSupported()) return null;
  const entry = await audioGet(track.id);
  if (!entry || !entryMatches(entry, track)) return null;
  const blob = await readFile(entry.fileName);
  if (!blob) {
    // Bookkeeping without bytes (cleared site data) — heal the record.
    await audioDelete(track.id);
    return null;
  }
  await audioPut({ ...entry, lastPlayedAt: Date.now() });
  return blob;
}

const inFlight = new Map<string, Promise<Blob>>();

/**
 * Downloads a track into the given tier (dedupes concurrent calls; upgrades
 * an existing cache entry to a pin without refetching).
 */
export function downloadTrack(
  track: Track,
  tier: AudioTier,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const existing = inFlight.get(track.id);
  if (existing) {
    // A pin asked for while the same song is still streaming into the cache:
    // let that transfer finish, then keep it, instead of leaving it evictable.
    if (tier !== "pin") return existing;
    return existing.then(async (blob) => {
      await promoteToPin(track.id);
      return blob;
    });
  }
  const p = doDownload(track, tier, onProgress, signal).finally(() => inFlight.delete(track.id));
  inFlight.set(track.id, p);
  return p;
}

/** Turns a cached copy into a kept download (no-op when it is one already). */
async function promoteToPin(trackId: string): Promise<void> {
  const entry = await audioGet(trackId);
  if (entry && entry.tier !== "pin") await audioPut({ ...entry, tier: "pin" });
}

async function doDownload(
  track: Track,
  tier: AudioTier,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!opfsSupported()) throw new Error("This browser does not support offline audio storage (OPFS).");
  if (!track.storageKey || !track.contentHash) throw new Error("This track has no audio in your vault.");

  let target = tier;
  const already = await audioGet(track.id);
  if (already && !entryMatches(already, track)) {
    // A copy from before this track reached the vault: replace it, keeping a pin.
    if (already.tier === "pin") target = "pin";
    await deleteFile(already.fileName);
    await audioDelete(track.id);
  } else if (already) {
    const blob = await readFile(already.fileName);
    if (blob) {
      if (tier === "pin" && already.tier !== "pin") {
        await audioPut({ ...already, tier: "pin" });
      }
      return blob;
    }
    await audioDelete(track.id);
  }

  // Pre-signed R2 URL: the bytes come straight from the vault.
  const url = await signedUrls()?.getOne(track.storageKey);
  if (!url) throw new Error("The vault refused this track (signed out, or it was deleted).");
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get("content-length") ?? track.fileSize ?? 0);

  const dir = await audioDir();
  const fileName = track.id;
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const reader = res.body.getReader();
  // Vault audio is named by its BLAKE3 hash — verify every byte we keep.
  const hasher = await createBLAKE3();
  hasher.init();
  let downloaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      await writable.write(value);
      downloaded += value.byteLength;
      onProgress?.({ downloaded, total });
    }
    if (hasher.digest("hex") !== track.contentHash) {
      throw new Error("The downloaded audio doesn't match this track (integrity check failed).");
    }
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => {});
    await deleteFile(fileName);
    throw err;
  }

  const blob = await readFile(fileName);
  if (!blob) throw new Error("Downloaded file vanished from storage.");

  await audioPut({
    trackId: track.id,
    fileName,
    tier: target,
    size: blob.size,
    contentHash: track.contentHash,
    addedAt: Date.now(),
    lastPlayedAt: Date.now(),
  });
  if (target === "cache") await evictOverCap();

  // First-download artwork extraction for tracks without an online cover
  // (metadata itself is canonical online; here we only need the picture).
  if (!track.artworkKey) void extractArtwork(track.id, blob);

  return blob;
}

async function extractArtwork(trackId: string, blob: Blob): Promise<void> {
  try {
    const meta = await parseBlob(blob, { skipPostHeaders: true });
    const pic = meta.common.picture?.[0];
    if (pic) {
      await putArtwork(trackId, new Blob([pic.data as BlobPart], { type: pic.format }));
      invalidateArtwork(trackId);
    }
  } catch {
    // Not fatal — some formats or corrupt tags just won't have artwork.
  }
}

/**
 * Play resolution: pinned/cache hit → bytes; else download into `tier` (the
 * auto-cache, or the downloads when auto-download keeps everything).
 */
export async function resolveTrackAudio(
  track: Track,
  onProgress?: (p: DownloadProgress) => void,
  tier: AudioTier = "cache",
): Promise<Blob> {
  const local = await getLocalAudio(track);
  if (local) return local;
  return downloadTrack(track, tier, onProgress);
}

/** Pin an existing entry / download as pinned. */
export async function pinTrack(
  track: Track,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  await downloadTrack(track, "pin", onProgress, signal);
}

export async function removeAudio(trackId: string): Promise<void> {
  const entry = await audioGet(trackId);
  if (!entry) return;
  await deleteFile(entry.fileName);
  await audioDelete(trackId);
}

export interface CacheStats {
  autoBytes: number;
  pinnedBytes: number;
  maxBytes: number;
}

export async function cacheStats(): Promise<CacheStats> {
  const entries = await audioAll();
  let autoBytes = 0;
  let pinnedBytes = 0;
  for (const e of entries) {
    if (e.tier === "pin") pinnedBytes += e.size;
    else autoBytes += e.size;
  }
  return { autoBytes, pinnedBytes, maxBytes: getCacheMaxBytes() };
}

export async function allEntries(): Promise<AudioEntry[]> {
  return audioAll();
}

/** Auto-cache entries that may go, least recently played first. */
async function evictable(): Promise<AudioEntry[]> {
  const entries = (await audioAll()).filter((e) => e.tier === "cache");
  return entries.sort((a, b) => a.lastPlayedAt - b.lastPlayedAt).slice(0, Math.max(0, entries.length - KEEP_RECENT));
}

/** Empties the auto-cache (pinned downloads stay). */
export async function clearAutoCache(): Promise<void> {
  for (const entry of await evictable()) {
    await deleteFile(entry.fileName);
    await audioDelete(entry.trackId);
  }
}

/** LRU eviction of the auto-cache tier down to the byte cap. */
export async function evictOverCap(): Promise<void> {
  const cap = getCacheMaxBytes();
  let used = (await audioAll()).filter((e) => e.tier === "cache").reduce((sum, e) => sum + e.size, 0);
  if (used <= cap) return;
  for (const entry of await evictable()) {
    if (used <= cap) break;
    await deleteFile(entry.fileName);
    await audioDelete(entry.trackId);
    used -= entry.size;
  }
}
