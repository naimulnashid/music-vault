/**
 * Playlists are stored in insertion order, which differs per device (SQLite
 * rows on desktop, IndexedDB shadow rows on web). Every list of them shown to
 * the user goes through this so the order is alphabetical and identical
 * everywhere.
 */
export function sortPlaylists<T extends { name: string }>(playlists: T[]): T[] {
  return [...playlists].sort((a, b) => a.name.localeCompare(b.name));
}
