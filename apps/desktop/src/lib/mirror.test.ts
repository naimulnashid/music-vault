import { describe, expect, it } from "vitest";
import type { TrackRow as RemoteTrackRow } from "@musicvault/core";
import { coverFileName, mirrorTracks, runSummary, safeFileName, spaceShortfall, tombstonedIds } from "./mirror";

const UID = "00000000-0000-4000-8000-00000000000a";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

function row(over: Partial<RemoteTrackRow>): RemoteTrackRow {
  return {
    id: "r1",
    user_id: UID,
    content_hash: H1,
    file_name: "song.flac",
    file_size: 100,
    title: "Title",
    artist: "",
    album: "Album",
    album_artist: null,
    genre: null,
    year: null,
    language: null,
    country: null,
    release_date: null,
    composer: null,
    track_no: null,
    disc_no: null,
    bpm: null,
    replaygain_track_db: null,
    replaygain_album_db: null,
    duration: 200,
    codec: "FLAC",
    sample_rate: 44100,
    bit_depth: 16,
    channels: 2,
    lyrics_text: null,
    lyrics_synced: null,
    storage_key: `users/${UID}/audio/${H1}.flac`,
    uploaded_at: "2026-10-11T10:00:00Z",
    artwork_key: null,
    field_edited_at: {},
    deleted_at: null,
    merged_into: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("mirrorTracks", () => {
  it("writes details as stored, with queued edits and no display fallbacks", () => {
    const out = mirrorTracks(
      [
        row({ release_date: "2019-05", lyrics_synced: [{ time: 1.5, text: "Hi" }], replaygain_track_db: -7.5 }),
        row({ id: "gone", content_hash: H2, deleted_at: "2026-10-12T00:00:00Z" }),
        row({ id: "unfinished", content_hash: H2, storage_key: null }),
      ],
      [{ keys: ["remote:r1"], patch: { genre: "Folk" }, editedAt: "2026-10-12T00:00:00.000Z" }],
    );
    expect(out).toEqual([
      {
        id: "r1",
        contentHash: H1,
        ext: "flac",
        fileSize: 100,
        title: "Title",
        artist: "",
        album: "Album",
        genre: "Folk",
        language: null,
        country: null,
        releaseDate: "2019-05",
        lyricsText: null,
        lrc: "[00:01.50]Hi\n",
        replayGainTrack: -7.5,
        replayGainAlbum: null,
        artworkKey: null,
      },
    ]);
  });

  it("only tombstoned rows count as removed", () => {
    expect(tombstonedIds([row({}), row({ id: "gone", deleted_at: "2026-10-12T00:00:00Z" })])).toEqual(["gone"]);
  });
});

describe("mirror messages", () => {
  it("stops a run that doesn't fit the drive", () => {
    expect(spaceShortfall(5 * 1024 ** 3, null)).toBeNull();
    expect(spaceShortfall(100, 200)).toBeNull();
    expect(spaceShortfall(5 * 1024 ** 3, 2 * 1024 ** 3)).toBe(
      "Not enough space on the backup folder's drive: 5.0 GB needed, 2.0 GB free.",
    );
  });

  it("sums up a run", () => {
    expect(runSummary({ total: 1040, failed: 0, untagged: 0, firstError: null })).toBe("1,040 songs backed up");
    expect(runSummary({ total: 3, failed: 1, untagged: 1, firstError: "x" })).toBe(
      "3 songs backed up • 1 song couldn't be written and will be tried again • 1 song copied without details (their format can't be tagged)",
    );
  });
});

describe("backup file names", () => {
  it("keeps names Windows accepts", () => {
    expect(safeFileName("AC/DC: Live?", "x")).toBe("AC_DC_ Live_");
    expect(safeFileName("Trailing dots...", "x")).toBe("Trailing dots");
    expect(safeFileName("CON", "artist")).toBe("artist");
    expect(safeFileName("   ", "artist")).toBe("artist");
  });

  it("names a cover by its hash", () => {
    expect(coverFileName(`users/u1/art/${"a".repeat(64)}.jpg`)).toBe(`${"a".repeat(64)}.jpg`);
  });
});
