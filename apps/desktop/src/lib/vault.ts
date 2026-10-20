import { createSupabaseVaultApi, SignedUrlCache, thumbKeyOf, type VaultApi } from "@musicvault/core";
import { supabase } from "./supabase";
import { vaultCached, vaultDownload, vaultFetchArt } from "./ipc";
import { artFileName, storageExt } from "./vaultMerge";
import { usePlayerStore } from "../store/playerStore";
import { useDownloadStore } from "../store/downloadStore";
import type { Track } from "../types";
import { emitAppError } from "./errorBus";
import { playbackErrorMessage } from "./playbackError";

/**
 * Desktop side of the vault: the shared API client, signed-URL cache, and the
 * download-then-play resolver for vault tracks (Rust does the transfer and
 * verifies the bytes against the content hash).
 */

let api: VaultApi | null = null;
let urls: SignedUrlCache | null = null;

/** The vault API, or null when this build has no account configured. */
export function vaultApi(): VaultApi | null {
  if (!supabase) return null;
  api ??= createSupabaseVaultApi(supabase);
  return api;
}

export function signedUrls(): SignedUrlCache | null {
  const vault = vaultApi();
  if (!vault) return null;
  urls ??= new SignedUrlCache(vault);
  return urls;
}

/** Sign-out: signed links belong to the account that asked for them. */
export function forgetSignedUrls(): void {
  urls = null;
}

/** MIME type sent with an audio upload. */
export function audioMime(ext: string): string {
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg";
    case "m4a":
    case "mp4":
    case "alac":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "aiff":
    case "aif":
      return "audio/aiff";
    default:
      return "application/octet-stream";
  }
}

/** Ensures a vault track is on disk (cache or pinned tier) and returns its path. */
export async function ensureVaultLocal(track: Track, pin: boolean): Promise<string> {
  const hash = track.contentHash;
  const key = track.storageKey;
  if (!hash || !key) throw new Error("not a vault track");
  if (!pin) {
    const cached = await vaultCached(hash);
    if (cached) return cached;
  }
  const url = await signedUrls()?.getOne(key);
  if (!url) throw new Error("the vault refused this track (signed out, or it was deleted)");
  return vaultDownload(hash, storageExt(key), url, pin);
}

const inFlight = new Set<string>();

/**
 * Play resolution for vault tracks; writes the local path back into the queue.
 * With auto-download on, a played song is kept as a download instead of cached.
 * `preload` (the song after this one) fails quietly; the toast comes if it is played.
 */
export function resolveVaultTrack(track: Track, { preload = false }: { preload?: boolean } = {}): void {
  if (track.path || inFlight.has(track.id)) return;
  inFlight.add(track.id);
  ensureVaultLocal(track, useDownloadStore.getState().autoDownload)
    .then((path) => usePlayerStore.getState().setTrackPath(track.id, path))
    .catch((err) => {
      console.error("[vault] resolve failed:", track.title, err);
      if (preload) return;
      emitAppError(playbackErrorMessage(track.title, err));
      // Nothing will start, so stop showing the song as playing.
      const player = usePlayerStore.getState();
      if (player.currentTrack?.id === track.id) player.setIsPlaying(false);
    })
    .finally(() => inFlight.delete(track.id));
}

const artInFlight = new Set<string>();
const artDone = new Map<string, string>();

/**
 * Downloads online covers (full + thumbnail) into the artwork cache and
 * returns artwork key → cached file name for every key now available.
 */
export async function fetchVaultArt(keys: string[]): Promise<Record<string, string>> {
  const cache = signedUrls();
  const out: Record<string, string> = {};
  const wanted: string[] = [];
  for (const key of new Set(keys)) {
    const done = artDone.get(key);
    if (done) out[key] = done;
    else if (!artInFlight.has(key) && artFileName(key)) wanted.push(key);
  }
  if (!cache || wanted.length === 0) return out;
  wanted.forEach((k) => artInFlight.add(k));
  try {
    const signed = await cache.get(wanted.flatMap((k) => [k, thumbKeyOf(k)]));
    let cursor = 0;
    const worker = async () => {
      while (cursor < wanted.length) {
        const key = wanted[cursor++];
        const file = artFileName(key)!;
        try {
          if (signed[key]) await vaultFetchArt(signed[key], file);
          else continue;
          const thumbUrl = signed[thumbKeyOf(key)];
          if (thumbUrl) await vaultFetchArt(thumbUrl, file.replace(/\.jpg$/, ".thumb.jpg")).catch(() => {});
          artDone.set(key, file);
          out[key] = file;
        } catch (err) {
          console.error("[vault] cover download failed:", key, err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, wanted.length) }, worker));
  } finally {
    wanted.forEach((k) => artInFlight.delete(k));
  }
  return out;
}
