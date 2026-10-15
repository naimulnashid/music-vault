import { describe, expect, it } from "vitest";
import type { TrackRow } from "@musicvault/core";
import { hashFile } from "./uploadPrepare";
import { applyPatchToTrack, pendingTrackEdits, projectRows, trackFromRow } from "./trackMap";

const UID = "00000000-0000-4000-8000-00000000000a";

function row(over: Partial<TrackRow>): TrackRow {
  return {
    id: "r1",
    user_id: UID,
    content_hash: "1".repeat(64),
    file_name: "song.flac",
    file_size: 100,
    title: "Title",
    artist: "Artist",
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
    codec: null,
    sample_rate: null,
    bit_depth: null,
    channels: null,
    lyrics_text: null,
    lyrics_synced: null,
    storage_key: null,
    uploaded_at: null,
    artwork_key: null,
    field_edited_at: {},
    deleted_at: null,
    merged_into: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("hashFile", () => {
  it("computes BLAKE3 matching the reference vectors, across read chunks", async () => {
    expect(await hashFile(new Blob([]))).toBe("af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");
    expect(await hashFile(new Blob(["abc"]))).toBe("6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85");
    // > 4 MiB forces several chunks; the result must equal a one-shot hash.
    const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251);
    const { blake3 } = await import("hash-wasm");
    expect(await hashFile(new Blob([big]))).toBe(await blake3(big));
  });
});

describe("track projection", () => {
  it("maps vault columns onto tracks", () => {
    const t = trackFromRow(row({ storage_key: "users/u/audio/x.flac", artwork_key: "users/u/art/y.jpg" }));
    expect(t.storageKey).toBe("users/u/audio/x.flac");
    expect(t.artworkKey).toBe("users/u/art/y.jpg");
  });

  it("keeps only vault tracks and overlays queued edits by any identity", () => {
    const audio = (h: string) => `users/u/audio/${h.repeat(64)}.flac`;
    const rows = [
      row({ id: "a", content_hash: "a".repeat(64), storage_key: audio("a") }),
      row({ id: "b", content_hash: "b".repeat(64), deleted_at: "2026-10-11T00:00:00Z" }),
      row({ id: "c", content_hash: "c".repeat(64), storage_key: audio("c"), title: "Server", field_edited_at: { title: "2026-10-11T12:00:00Z" } }),
      row({ id: "d", content_hash: "d".repeat(64) }), // upload never committed: no audio
    ];
    const pending = pendingTrackEdits([
      {
        id: "op1",
        deviceId: null,
        createdAt: "",
        payload: { kind: "track.edit", track: { contentHash: "a".repeat(64) }, patch: { title: "Queued" }, editedAt: "2026-10-11T12:00:00Z" },
      },
      {
        id: "op2",
        deviceId: null,
        createdAt: "",
        payload: { kind: "track.edit", track: { remoteId: "c" }, patch: { title: "Older" }, editedAt: "2026-10-11T11:00:00Z" },
      },
      { id: "op3", deviceId: null, createdAt: "", payload: { kind: "favorite.set", track: { remoteId: "a" }, favorite: true, editedAt: "x" } },
    ]);
    expect(pending).toHaveLength(2);
    const tracks = projectRows(rows, pending);
    expect(tracks.map((t) => t.id)).toEqual(["a", "c"]);
    expect(tracks[0].title).toBe("Queued");
    expect(tracks[1].title).toBe("Server"); // the older queued edit loses to the server's newer one
  });

  it("applies patches to tracks optimistically", () => {
    const t = applyPatchToTrack(trackFromRow(row({ genre: "Pop" })), { title: "New", genre: null, release_date: "1999-05", country: "Bangladesh" });
    expect(t).toMatchObject({ title: "New", genre: undefined, year: 1999, releaseDate: "1999-05", country: "Bangladesh" });
  });
});
