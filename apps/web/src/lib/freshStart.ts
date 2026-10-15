import { deleteDB } from "idb";
import { clearLibraryStores } from "./db";

/**
 * The library was rebuilt from scratch when Google Drive was retired
 * (docs/drive-to-r2-migration.md, decision 8): the server data was wiped, so
 * whatever this browser still holds from before — synced state, the local
 * play-event log, cached audio and artwork, listening history — is cleared
 * once, before sync starts, or old playlists and history could sync back.
 * Device preferences (theme, EQ, volume, cache size) are kept.
 */
const MARKER = "mv.freshStart";
const VERSION = "2026-10-11";

const LOCAL_KEYS = [
  "music-vault-history",
  "music-vault-playcounts",
  "music-vault-listenseconds",
  "music-vault-lastplayed",
  "music-vault-lastplayback",
];

/**
 * Runs the reset if this browser hasn't had it. Resolves true when old data
 * was actually cleared — the caller reloads so no in-memory copy survives.
 */
export async function freshStartOnce(): Promise<boolean> {
  try {
    if (localStorage.getItem(MARKER) === VERSION) return false;
  } catch {
    return false; // no storage at all: nothing to clear
  }

  const known = (await indexedDB.databases?.().catch(() => [])) ?? [];
  const hadData =
    LOCAL_KEYS.some((k) => localStorage.getItem(k) !== null) ||
    known.some((d) => d.name === "mv-sync" || d.name === "mv-stats" || d.name === "music-vault-web");

  if (hadData) {
    for (const k of LOCAL_KEYS) localStorage.removeItem(k);
    await deleteDB("mv-sync").catch(() => {});
    await deleteDB("mv-stats").catch(() => {});
    await clearLibraryStores().catch(() => {});
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("audio", { recursive: true });
    } catch {
      // No OPFS, or no audio folder yet.
    }
  }
  localStorage.setItem(MARKER, VERSION);
  return hadData;
}
