import { describe, expect, it } from "vitest";
import { AUDIO_EXTS as SERVER_AUDIO_EXTS } from "../../../supabase/functions/vault/keys";
import type { TrackRow } from "../src/supabase/database.types";
import type { TrackEditPatch } from "../src/trackFields";
import {
  applyBatchFields,
  AUDIO_EXTS,
  audioExtOf,
  coverEdge,
  draftFromSource,
  newTrackRow,
  type PreparedCover,
  squareCrop,
  type UploadDeps,
  type UploadDraft,
  type UploadSource,
  uploadTrack,
  validateDraft,
} from "../src/upload";
import type { VaultApi } from "../src/vault";

const USER = "00000000-0000-4000-8000-00000000000a";
const HASH = "b".repeat(64);
const ART = "c".repeat(64);

const source = (over: Partial<UploadSource> = {}): UploadSource => ({
  fileName: "01 - Some Song.flac",
  fileSize: 1234,
  contentHash: HASH,
  ext: "flac",
  technical: {
    duration: 200.5,
    codec: "FLAC",
    sample_rate: 44100,
    bit_depth: 16,
    channels: 2,
    replaygain_track_db: -6.2,
    replaygain_album_db: null,
  },
  tags: { title: "Tagged Title", artist: "Tagged Artist", release_date: "2001" },
  ...over,
});

const cover: PreparedCover = { sha256: ART, fullSize: 1000, thumbSize: 100, handle: "cover-bytes" };

describe("upload helpers", () => {
  it("accepts exactly the extensions the vault function accepts", () => {
    expect([...AUDIO_EXTS].sort()).toEqual([...SERVER_AUDIO_EXTS].sort());
    expect(audioExtOf("Song.FLAC")).toBe("flac");
    expect(audioExtOf("track.m4a")).toBe("m4a");
    expect(audioExtOf("notes.txt")).toBeNull();
    expect(audioExtOf("noext")).toBeNull();
  });

  it("crops covers to a centred square and never upscales", () => {
    expect(squareCrop(1600, 1200)).toEqual({ sx: 200, sy: 0, size: 1200 });
    expect(squareCrop(500, 701)).toEqual({ sx: 0, sy: 100, size: 500 });
    expect(coverEdge(3000, 1200)).toBe(1200);
    expect(coverEdge(300, 1200)).toBe(300);
  });

  it("starts the form from the tags, with the file name as a fallback title", () => {
    expect(draftFromSource(source()).fields).toEqual({ title: "Tagged Title", artist: "Tagged Artist", release_date: "2001" });
    expect(draftFromSource(source({ tags: {} })).fields.title).toBe("01 - Some Song");
    expect(draftFromSource(source({ embeddedCover: cover })).cover).toBe(cover);
    expect(draftFromSource(source()).cover).toBeNull();
  });

  it("applies batch fields and a shared cover to every draft", () => {
    const drafts = [draftFromSource(source()), draftFromSource(source({ tags: { title: "Two" } }))];
    const out = applyBatchFields(drafts, { album: "Shared", language: "Bangla" }, cover);
    expect(out.map((d) => [d.fields.title, d.fields.album, d.fields.language, d.cover])).toEqual([
      ["Tagged Title", "Shared", "Bangla", cover],
      ["Two", "Shared", "Bangla", cover],
    ]);
    expect(applyBatchFields(out, {}, null).every((d) => d.cover === null)).toBe(true);
    expect(applyBatchFields(out, {}).every((d) => d.cover === cover)).toBe(true);
  });

  it("validates drafts", () => {
    expect(validateDraft(draftFromSource(source()))).toEqual([]);
    const bad: UploadDraft = { ...draftFromSource(source({ ext: "exe", contentHash: "nope" })), fields: { title: " " } };
    expect(validateDraft(bad)).toHaveLength(3);
  });

  it("builds a full row for a new song, metadata from the form and facts from the file", () => {
    const row = newTrackRow(USER, draftFromSource(source()), "users/x/art/y.jpg");
    expect(row).toMatchObject({
      user_id: USER,
      content_hash: HASH,
      file_name: "01 - Some Song.flac",
      file_size: 1234,
      title: "Tagged Title",
      artist: "Tagged Artist",
      album: "",
      release_date: "2001",
      duration: 200.5,
      codec: "FLAC",
      artwork_key: "users/x/art/y.jpg",
    });
  });
});

// ---- uploadTrack --------------------------------------------------------------

function existingRow(over: Partial<TrackRow> = {}): TrackRow {
  return {
    id: "track-1",
    user_id: USER,
    content_hash: HASH,
    file_name: "old.flac",
    file_size: 1234,
    title: "Online Title",
    artist: "Tagged Artist",
    album: "",
    album_artist: null,
    genre: null,
    year: 2001,
    language: "Bangla",
    country: null,
    featured_artists: null,
    subgenre: null,
    secondary_genres: null,
    mood: null,
    vocals: null,
    release_date: "2001",
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
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function harness(opts: { target?: string | null; existing?: TrackRow | null } = {}) {
  const log: string[] = [];
  const edits: TrackEditPatch[] = [];
  const inserted: unknown[] = [];
  const vault: VaultApi = {
    signGet: async () => ({ urls: {}, denied: [], expiresIn: 0 }),
    signPutAudio: async (trackId, ext) => {
      log.push(`sign-put audio ${trackId}.${ext}`);
      return { key: `users/${USER}/audio/${HASH}.${ext}`, url: "put-audio", expiresIn: 900 };
    },
    signPutArt: async (sha, variant) => {
      log.push(`sign-put art ${variant}`);
      return { key: `users/${USER}/art/${sha}${variant === "thumb" ? ".thumb" : ""}.jpg`, url: `put-${variant}`, expiresIn: 900 };
    },
    commit: async (trackId, ext) => {
      log.push(`commit ${trackId}`);
      return { trackId, storageKey: `users/${USER}/audio/${HASH}.${ext}`, size: 1234 };
    },
    remove: async () => {},
    resolveUploadTarget: async (hash) => {
      log.push(`resolve ${hash === HASH}`);
      return opts.target ?? null;
    },
  };
  const deps: UploadDeps = {
    userId: USER,
    vault,
    getTrack: async () => opts.existing ?? null,
    insertTrack: async (row) => {
      inserted.push(row);
      log.push("insert");
      return "new-track";
    },
    updateTechnical: async (id) => {
      log.push(`technical ${id}`);
    },
    applyEdit: async (id, patch) => {
      edits.push(patch);
      log.push(`edit ${id}`);
    },
    putAudio: async (url) => {
      log.push(`PUT ${url}`);
    },
    putCover: async (url) => {
      log.push(`PUT ${url}`);
    },
  };
  return { deps, log, edits, inserted };
}

describe("uploadTrack", () => {
  it("creates, uploads and commits a new song (cover first, so the row can reference it)", async () => {
    const h = harness();
    const result = await uploadTrack(h.deps, { ...draftFromSource(source()), cover });
    expect(result).toEqual({ status: "uploaded", trackId: "new-track", storageKey: `users/${USER}/audio/${HASH}.flac` });
    expect(h.log).toEqual([
      "resolve true",
      "sign-put art full",
      "PUT put-full",
      "sign-put art thumb",
      "PUT put-thumb",
      "insert",
      "sign-put audio new-track.flac",
      "PUT put-audio",
      "commit new-track",
    ]);
    expect(h.inserted[0]).toMatchObject({ artwork_key: `users/${USER}/art/${ART}.jpg`, title: "Tagged Title" });
  });

  it("links to an existing row, keeps its history and only edits what the form changed", async () => {
    const h = harness({ target: "track-1", existing: existingRow() });
    const draft = draftFromSource(source());
    draft.fields = { ...draft.fields, title: "Online Title", genre: "Folk" }; // title unchanged vs. online
    const result = await uploadTrack(h.deps, draft);
    expect(result.status).toBe("linked");
    expect(h.edits).toEqual([{ genre: "Folk" }]);
    expect(h.log).toEqual([
      "resolve true",
      "technical track-1",
      "sign-put audio track-1.flac",
      "PUT put-audio",
      "commit track-1",
      "edit track-1",
    ]);
  });

  it("revives a deleted track instead of creating a duplicate", async () => {
    const h = harness({ target: "track-1", existing: existingRow({ deleted_at: "2026-10-11T00:00:00Z" }) });
    const result = await uploadTrack(h.deps, draftFromSource(source({ tags: { title: "Online Title", artist: "Tagged Artist", release_date: "2001" } })));
    expect(result.status).toBe("linked");
    expect(h.inserted).toEqual([]);
    expect(h.edits).toEqual([]);
  });

  it("edits a revived track only after the commit brings it back (cover included)", async () => {
    const h = harness({ target: "track-1", existing: existingRow({ deleted_at: "2026-10-11T00:00:00Z" }) });
    await uploadTrack(h.deps, { ...draftFromSource(source({ tags: { title: "Online Title", artist: "Tagged Artist", release_date: "2001" } })), cover });
    expect(h.edits).toEqual([{ artwork_key: `users/${USER}/art/${ART}.jpg` }]);
    expect(h.log.indexOf("edit track-1")).toBeGreaterThan(h.log.indexOf("commit track-1"));
  });

  it("does nothing for a file that is already in the vault", async () => {
    const h = harness({ target: "track-1", existing: existingRow({ storage_key: "users/x/audio/y.flac" }) });
    expect(await uploadTrack(h.deps, draftFromSource(source()))).toEqual({ status: "already-in-vault", trackId: "track-1" });
    expect(h.log).toEqual(["resolve true"]);
  });

  it("refuses invalid drafts before touching the network", async () => {
    const h = harness();
    await expect(uploadTrack(h.deps, { ...draftFromSource(source()), fields: { title: "" } })).rejects.toThrow(/Title/);
    expect(h.log).toEqual([]);
  });

  it("is safe to retry after a failed transfer: the second run finds the row and finishes", async () => {
    const h = harness();
    let fail = true;
    h.deps.putAudio = async () => {
      if (fail) {
        fail = false;
        throw new Error("connection reset");
      }
    };
    await expect(uploadTrack(h.deps, draftFromSource(source()))).rejects.toThrow("connection reset");

    // On retry, resolve_upload_target finds the row inserted by the first attempt.
    const retry = harness({ target: "new-track", existing: existingRow({ id: "new-track", title: "Tagged Title" }) });
    const result = await uploadTrack(retry.deps, draftFromSource(source()));
    expect(result).toMatchObject({ status: "linked", trackId: "new-track" });
    expect(retry.inserted).toEqual([]);
  });
});
