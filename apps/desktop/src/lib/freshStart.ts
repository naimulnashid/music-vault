/**
 * The library was rebuilt from scratch when Google Drive and local folders
 * were retired (docs/drive-to-r2-migration.md, decision 8). SQLite clears its
 * part in the schema v9 upgrade (Rust); this clears the listening history the
 * webview keeps in localStorage, once, before any store reads it. Device
 * preferences (theme, EQ, volume) are kept.
 *
 * Imported first by main.tsx so it runs before the stores initialize.
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

try {
  if (localStorage.getItem(MARKER) !== VERSION) {
    for (const key of LOCAL_KEYS) localStorage.removeItem(key);
    localStorage.setItem(MARKER, VERSION);
  }
} catch {
  // No storage available: nothing to clear.
}

export {};
