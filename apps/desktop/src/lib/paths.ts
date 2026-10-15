import { appDataDir, join } from "@tauri-apps/api/path";

let artworkDirCache: string | null = null;

/** Resolve and cache well-known app directories. Called once at startup. */
export async function initPaths(): Promise<void> {
  try {
    const dataDir = await appDataDir();
    artworkDirCache = await join(dataDir, "artwork");
  } catch (err) {
    console.error("[paths] failed to resolve app data dir:", err);
  }
}

/** Absolute path of the artwork cache directory (null until initPaths ran). */
export function artworkDir(): string | null {
  return artworkDirCache;
}
