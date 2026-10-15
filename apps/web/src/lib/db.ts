import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Settings } from "../types";

/**
 * App-local (NOT synced) persistence: settings snapshot, artwork extracted
 * from downloaded files, and the two-tier audio cache bookkeeping. Synced
 * state lives in the sync engine's own database (mv-sync).
 */

export type AudioTier = "cache" | "pin";

export interface AudioEntry {
  /** Canonical track id (Supabase tracks.id). */
  trackId: string;
  /** OPFS file name under /audio. */
  fileName: string;
  /**
   * BLAKE3 of the bytes. A copy whose hash differs from the track's (or that
   * has none) is fetched again rather than served stale.
   */
  contentHash?: string;
  tier: AudioTier;
  size: number;
  addedAt: number;
  lastPlayedAt: number;
}

interface WebDB extends DBSchema {
  settings: { key: string; value: Settings };
  kv: { key: string; value: unknown };
  artwork: { key: string; value: { trackId: string; blob: Blob } };
  audio: {
    key: string;
    value: AudioEntry;
    indexes: { "by-tier": string };
  };
}

let dbPromise: Promise<IDBPDatabase<WebDB>> | null = null;

function getDb(): Promise<IDBPDatabase<WebDB>> {
  dbPromise ??= openDB<WebDB>("music-vault-web", 1, {
    upgrade(db) {
      db.createObjectStore("settings", { keyPath: "id" });
      db.createObjectStore("kv");
      db.createObjectStore("artwork", { keyPath: "trackId" });
      const audio = db.createObjectStore("audio", { keyPath: "trackId" });
      audio.createIndex("by-tier", "tier");
    },
  });
  return dbPromise;
}

export async function getSettings(): Promise<Settings | undefined> {
  return (await getDb()).get("settings", "settings");
}

export async function putSettings(settings: Settings): Promise<void> {
  await (await getDb()).put("settings", settings);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await getDb()).get("kv", key) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await getDb()).put("kv", value, key);
}

export async function getArtwork(trackId: string): Promise<Blob | undefined> {
  return (await (await getDb()).get("artwork", trackId))?.blob;
}

export async function putArtwork(trackId: string, blob: Blob): Promise<void> {
  await (await getDb()).put("artwork", { trackId, blob });
}

export async function audioGet(trackId: string): Promise<AudioEntry | undefined> {
  return (await getDb()).get("audio", trackId);
}

export async function audioAll(): Promise<AudioEntry[]> {
  return (await getDb()).getAll("audio");
}

export async function audioPut(entry: AudioEntry): Promise<void> {
  await (await getDb()).put("audio", entry);
}

export async function audioDelete(trackId: string): Promise<void> {
  await (await getDb()).delete("audio", trackId);
}

/** Clears everything here except settings (the one-time fresh start, lib/freshStart.ts). */
export async function clearLibraryStores(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear("kv"), db.clear("artwork"), db.clear("audio")]);
}
