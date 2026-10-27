import { describe, expect, it } from "vitest";
import type { TrackRow as RemoteTrackRow } from "@musicvault/core";
import { artFileName, projectVault, storageExt, type PendingTrackEdit } from "./vaultMerge";

const UID = "00000000-0000-4000-8000-00000000000a";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const ART = `users/${UID}/art/${"c".repeat(64)}.jpg`;

function row(over: Partial<RemoteTrackRow>): RemoteTrackRow {
  return {
    id: "r1",
    user_id: UID,
    content_hash: H1,
    file_name: "song.flac",
    file_size: 100,
    title: "Online Title",
    artist: "Online Artist",
    album: "Online Album",
    album_artist: null,
    genre: null,
    year: null,
    language: null,
    country: null,
    featured_artists: null,
    subgenre: null,
    secondary_genres: null,
    mood: null,
    vocals: null,
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

const AUDIO = `users/${UID}/audio/${H1}.flac`;

describe("projectVault", () => {
  it("turns live rows with vault audio into tracks, exactly as stored online", () => {
    const out = projectVault(
      [
        row({ storage_key: AUDIO, uploaded_at: "2026-10-11T10:00:00Z", genre: "Folk", artwork_key: ART }),
        row({ id: "gone", content_hash: H2, deleted_at: "2026-10-11T00:00:00Z" }),
        row({ id: "unfinished", content_hash: H2 }), // upload never committed
      ],
      [],
      { [ART]: "vault-cover.jpg" },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: `vault:${H1}`,
      path: "",
      remoteId: "r1",
      storageKey: AUDIO,
      title: "Online Title",
      genre: "Folk",
      artworkPath: "vault-cover.jpg",
    });
    expect(out[0].addedAt).toBe(Date.parse("2026-10-11T10:00:00Z"));
  });

  it("shows queued edits before they flush, by any identity", () => {
    const pending: PendingTrackEdit[] = [
      { keys: [`hash:${H1}`], patch: { title: "Queued", language: "Bangla" }, editedAt: "2026-10-11T12:00:00.000Z" },
      { keys: ["remote:r2"], patch: { album: "Queued Album" }, editedAt: "2026-10-11T12:00:00.000Z" },
    ];
    const out = projectVault(
      [row({ storage_key: AUDIO }), row({ id: "r2", content_hash: H2, storage_key: `users/${UID}/audio/${H2}.mp3` })],
      pending,
      {},
    );
    expect(out[0]).toMatchObject({ title: "Queued", language: "Bangla" });
    expect(out[1].album).toBe("Queued Album");
  });

  it("a queued edit older than the server's edit of that field doesn't win", () => {
    const pending: PendingTrackEdit[] = [{ keys: ["remote:r1"], patch: { title: "Stale" }, editedAt: "2026-10-01T00:00:00.000Z" }];
    const [t] = projectVault(
      [row({ storage_key: AUDIO, title: "Server", field_edited_at: { title: "2026-10-11T00:00:00.000Z" } })],
      pending,
      {},
    );
    expect(t.title).toBe("Server");
  });
});

describe("helpers", () => {
  it("derive art file names and storage extensions", () => {
    expect(artFileName(ART)).toBe(`vault-${"c".repeat(64)}.jpg`);
    expect(artFileName("nope")).toBeNull();
    expect(storageExt(`users/${UID}/audio/${H1}.flac`)).toBe("flac");
  });
});
