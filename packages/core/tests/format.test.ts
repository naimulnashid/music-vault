import { describe, expect, it } from "vitest";
import { formatDurationLong, formatTime } from "../src/format";
import { albumKey, groupAlbums } from "../src/albums";
import type { Track } from "../src/types";

describe("formatTime", () => {
  it("formats mm:ss with zero padding", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("clamps invalid input", () => {
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
  });
});

describe("formatDurationLong", () => {
  it("picks the right unit pair", () => {
    expect(formatDurationLong(42)).toBe("42s");
    expect(formatDurationLong(36 * 60 + 5)).toBe("36m 5s");
    expect(formatDurationLong(2 * 3600 + 14 * 60)).toBe("2h 14m");
    expect(formatDurationLong(-1)).toBe("0s");
  });
});

describe("groupAlbums", () => {
  const t = (id: string, album: string, artist: string, albumArtist?: string): Track => ({
    id,
    fileName: id,
    fileSize: 1,
    title: id,
    artist,
    album,
    albumArtist,
    duration: 1,
    addedAt: 0,
  });

  it("groups by album and sorts by album name", () => {
    const albums = groupAlbums([t("1", "Zebra", "X"), t("2", "Alpha", "Y"), t("3", "Zebra", "X")]);
    expect(albums.map((a) => a.album)).toEqual(["Alpha", "Zebra"]);
    expect(albums[1].tracks.map((t) => t.id)).toEqual(["1", "3"]);
    expect(albums[1].artist).toBe("X");
  });

  it("keeps songs by different singers in one album", () => {
    const albums = groupAlbums([t("1", "Autograph", "A"), t("2", "Autograph ", "B")]);
    expect(albums).toHaveLength(1);
    expect(albums[0].artist).toBe("Various Artists");
    const tagged = groupAlbums([t("1", "Film", "A", "Lead"), t("2", "Film", "B, C", "Lead")]);
    expect(tagged).toHaveLength(1);
    expect(tagged[0].artist).toBe("Lead");
  });

  it("keeps same-titled albums by different album artists apart", () => {
    const albums = groupAlbums([t("1", "Hits", "A", "A"), t("2", "Hits", "B", "B")]);
    expect(albums).toHaveLength(2);
    expect(albumKey(albums[0].tracks[0])).toBe(albums[0].key);
  });

  it("groups songs without an album per artist", () => {
    expect(groupAlbums([t("1", "", "A"), t("2", "", "B")])).toHaveLength(2);
  });
});
