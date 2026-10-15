import { describe, expect, it } from "vitest";
import type { Track } from "../src/types";
import { computeSmartGroups, computeSmartTracks } from "../src/smartPlaylists";

function track(overrides: Partial<Track> & { id: string }): Track {
  return {
    fileName: `${overrides.id}.flac`,
    fileSize: 1,
    title: overrides.id,
    artist: "Artist",
    album: "Album",
    duration: 100,
    addedAt: 0,
    ...overrides,
  };
}

const tracks: Track[] = [
  track({ id: "a", addedAt: 1, genre: "Rock", year: 2020, favorite: true }),
  track({ id: "b", addedAt: 3, genre: "Pop", year: 2021 }),
  track({ id: "c", addedAt: 2, year: 2020 }),
];

describe("computeSmartTracks", () => {
  it("recentlyAdded sorts newest first", () => {
    expect(computeSmartTracks("recentlyAdded", tracks, { recentIds: [], playCounts: {} }).map((t) => t.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("recentlyPlayed follows history order and drops missing ids", () => {
    const result = computeSmartTracks("recentlyPlayed", tracks, {
      recentIds: ["c", "ghost", "a"],
      playCounts: {},
    });
    expect(result.map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("mostPlayed sorts by play count and excludes unplayed", () => {
    const result = computeSmartTracks("mostPlayed", tracks, {
      recentIds: [],
      playCounts: { a: 2, b: 7 },
    });
    expect(result.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("favorites and neverPlayed filter correctly", () => {
    expect(computeSmartTracks("favorites", tracks, { recentIds: [], playCounts: {} }).map((t) => t.id)).toEqual(["a"]);
    expect(
      computeSmartTracks("neverPlayed", tracks, { recentIds: [], playCounts: { a: 1 } }).map((t) => t.id),
    ).toEqual(["b", "c"]);
  });
});

describe("computeSmartGroups", () => {
  it("groups by genre with Unknown fallback, sorted by name", () => {
    const groups = computeSmartGroups("genre", tracks);
    expect(groups.map((g) => g.name)).toEqual(["Pop", "Rock", "Unknown Genre"]);
  });

  it("groups by year, newest first, Unknown last", () => {
    const withUnknown = [...tracks, track({ id: "d" })];
    const groups = computeSmartGroups("year", withUnknown);
    expect(groups.map((g) => g.name)).toEqual(["2021", "2020", "Unknown Year"]);
    expect(groups[1].tracks.map((t) => t.id)).toEqual(["a", "c"]);
  });
});
