import { describe, expect, it } from "vitest";
import type { Track } from "../src/types";
import { computeSmartGroups, computeSmartTracks, hasArtist, splitNames } from "../src/smartPlaylists";

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

  it("lists a song under each comma-separated artist and genre", () => {
    const shared = [track({ id: "x", artist: "A, B", genre: "Rock,Pop" }), track({ id: "y", artist: "B" })];
    const artists = computeSmartGroups("artist", shared);
    expect(artists.map((g) => [g.name, g.tracks.map((t) => t.id)])).toEqual([
      ["A", ["x"]],
      ["B", ["x", "y"]],
    ]);
    expect(computeSmartGroups("genre", shared).map((g) => g.name)).toEqual(["Pop", "Rock", "Unknown Genre"]);
  });

  it("groups by country with Unknown fallback", () => {
    const groups = computeSmartGroups("country", [track({ id: "x", country: "India" }), track({ id: "y" })]);
    expect(groups.map((g) => g.name)).toEqual(["India", "Unknown Country"]);
  });
});

describe("splitNames", () => {
  it("trims, drops blanks and duplicates", () => {
    expect(splitNames(" A ,, B, A ")).toEqual(["A", "B"]);
    expect(splitNames(undefined)).toEqual([]);
  });

  it("hasArtist matches the whole tag or one of its names", () => {
    expect(hasArtist({ artist: "A, B" }, "B")).toBe(true);
    expect(hasArtist({ artist: "A, B" }, "A, B")).toBe(true);
    expect(hasArtist({ artist: "AB" }, "A")).toBe(false);
  });
});
