import type { Track } from "./types";

export type SmartKey =
  | "recentlyAdded"
  | "recentlyPlayed"
  | "mostPlayed"
  | "favorites"
  | "neverPlayed"
  | "genre"
  | "artist"
  | "year"
  | "language";

export type SmartKind = "list" | "group";

export interface SmartDef {
  key: SmartKey;
  label: string;
  kind: SmartKind;
  emptyMessage: string;
}

export const SMART_PLAYLISTS: SmartDef[] = [
  { key: "recentlyAdded", label: "Recently Added", kind: "list", emptyMessage: "Upload some music to see it here." },
  { key: "recentlyPlayed", label: "Recently Played", kind: "list", emptyMessage: "Nothing played yet." },
  { key: "mostPlayed", label: "Most Played", kind: "list", emptyMessage: "Play some tracks to build this list." },
  { key: "favorites", label: "Favorites", kind: "list", emptyMessage: "Tap the heart on any song to add it here." },
  { key: "neverPlayed", label: "Never Played", kind: "list", emptyMessage: "Every track has been played at least once." },
  { key: "genre", label: "By Genre", kind: "group", emptyMessage: "No genre tags found in your library." },
  { key: "artist", label: "By Artist", kind: "group", emptyMessage: "No artists found." },
  { key: "year", label: "By Year", kind: "group", emptyMessage: "No year tags found in your library." },
  { key: "language", label: "By Language", kind: "group", emptyMessage: "No language tags found in your library." },
];

export function smartDef(key: SmartKey): SmartDef {
  return SMART_PLAYLISTS.find((s) => s.key === key)!;
}

export interface HistoryData {
  recentIds: string[];
  playCounts: Record<string, number>;
}

export function computeSmartTracks<T extends Track>(key: SmartKey, tracks: T[], history: HistoryData): T[] {
  switch (key) {
    case "recentlyAdded":
      return [...tracks].sort((a, b) => b.addedAt - a.addedAt);
    case "recentlyPlayed": {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      return history.recentIds.map((id) => byId.get(id)).filter((t): t is T => Boolean(t));
    }
    case "mostPlayed":
      return tracks
        .filter((t) => (history.playCounts[t.id] ?? 0) > 0)
        .sort((a, b) => (history.playCounts[b.id] ?? 0) - (history.playCounts[a.id] ?? 0));
    case "favorites":
      return tracks.filter((t) => t.favorite);
    case "neverPlayed":
      return tracks.filter((t) => !(history.playCounts[t.id] ?? 0));
    default:
      return [];
  }
}

export interface SmartGroup<T extends Track = Track> {
  name: string;
  tracks: T[];
}

function groupOf(key: SmartKey, track: Track): string {
  switch (key) {
    case "genre":
      return track.genre || "Unknown Genre";
    case "artist":
      return track.artist || "Unknown Artist";
    case "year":
      return track.year ? String(track.year) : "Unknown Year";
    case "language":
      return track.language || "Unknown Language";
    default:
      return "";
  }
}

export function computeSmartGroups<T extends Track>(key: SmartKey, tracks: T[]): SmartGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const track of tracks) {
    const name = groupOf(key, track);
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(track);
  }
  const groups = [...map.entries()].map(([name, groupTracks]) => ({ name, tracks: groupTracks }));

  if (key === "year") {
    groups.sort((a, b) => {
      const ay = a.name.startsWith("Unknown") ? -1 : Number(a.name);
      const by = b.name.startsWith("Unknown") ? -1 : Number(b.name);
      return by - ay;
    });
  } else {
    groups.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
}
