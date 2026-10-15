import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyTrackEdit,
  diffTrackFields,
  EDITABLE_TRACK_FIELDS,
  type EditableTrackRow,
  isValidTrackPatch,
  normalizeTrackPatch,
  overlayTrackEdits,
  READ_ONLY_TRACK_FIELDS,
  releaseDateFromTag,
  TrackEditError,
  type TrackEditPatch,
  yearOfReleaseDate,
} from "../src/trackFields";

interface GoldenCase {
  name: string;
  row?: Partial<EditableTrackRow>;
  edits: { patch: TrackEditPatch; editedAt: string }[];
  expected?: Partial<EditableTrackRow>;
  error?: string;
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../docs/fixtures/track-edit.golden.json", import.meta.url)), "utf8"),
) as { row: EditableTrackRow; cases: GoldenCase[] };

describe("track edit golden fixtures (shared with Kotlin and apply_track_edit)", () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const start: EditableTrackRow = { ...golden.row, ...c.row };
      if (c.error) {
        expect(c.edits).toHaveLength(1);
        let caught: unknown;
        try {
          applyTrackEdit(start, c.edits[0].patch, c.edits[0].editedAt);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(TrackEditError);
        expect((caught as TrackEditError).code).toBe(c.error);
        return;
      }
      let row = start;
      for (const edit of c.edits) row = applyTrackEdit(row, edit.patch, edit.editedAt);
      expect(row).toEqual({ ...start, ...c.expected });
    });
  }

  it("has meaningful coverage", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(20);
  });

  it("does not mutate its input", () => {
    const row: EditableTrackRow = { ...golden.row, field_edited_at: {} };
    applyTrackEdit(row, { title: "New" }, "2026-10-11T12:00:00.000Z");
    expect(row.title).toBe("Original");
    expect(row.field_edited_at).toEqual({});
  });
});

describe("field tables", () => {
  it("list each field once and keep technical fields out of the editor", () => {
    const editable = EDITABLE_TRACK_FIELDS.map((f) => f.key);
    const readOnly = READ_ONLY_TRACK_FIELDS.map((f) => f.key);
    expect(new Set(editable).size).toBe(editable.length);
    expect(editable.filter((k) => (readOnly as string[]).includes(k))).toEqual([]);
    expect(readOnly).toContain("duration");
    expect(editable).toContain("language");
  });
});

describe("normalizeTrackPatch", () => {
  it("trims text and turns blanks into null on optional fields", () => {
    expect(
      normalizeTrackPatch({ title: "  Song ", artist: " A ", genre: "  ", language: " Bangla ", lyrics_text: "line\n\n" }),
    ).toEqual({ title: "Song", artist: "A", genre: null, language: "Bangla", lyrics_text: "line" });
  });

  it("keeps required text fields as empty strings", () => {
    expect(normalizeTrackPatch({ artist: "", album: null })).toEqual({ artist: "", album: "" });
  });

  it("accepts a year, a month or a full release date", () => {
    expect(normalizeTrackPatch({ release_date: " 1999 ", country: " Bangladesh " })).toEqual({
      release_date: "1999",
      country: "Bangladesh",
    });
    expect(normalizeTrackPatch({ release_date: "1999-05" })).toEqual({ release_date: "1999-05" });
    expect(normalizeTrackPatch({ release_date: "2024-02-29" })).toEqual({ release_date: "2024-02-29" });
    expect(normalizeTrackPatch({ release_date: "", country: "" })).toEqual({ release_date: null, country: null });
    for (const bad of ["19x9", "99", "1999-13", "1999-5-1", "2023-02-29", "1999/05/14"]) {
      expect(() => normalizeTrackPatch({ release_date: bad })).toThrow(TrackEditError);
    }
  });

  it("no longer edits the retired tag fields", () => {
    for (const key of ["year", "album_artist", "composer", "track_no", "disc_no", "bpm"]) {
      expect(() => normalizeTrackPatch({ [key]: 1 })).toThrow(/not editable/);
    }
  });

  it("reads release dates from tags", () => {
    expect(releaseDateFromTag("2019")).toBe("2019");
    expect(releaseDateFromTag(2019)).toBe("2019");
    expect(releaseDateFromTag("2019-05-14T10:00:00")).toBe("2019-05-14");
    expect(releaseDateFromTag("2019/5/4")).toBe("2019-05-04");
    expect(releaseDateFromTag("2019-02-30")).toBe("2019-02");
    expect(releaseDateFromTag("2019-13-01")).toBe("2019");
    expect(releaseDateFromTag("0000")).toBeNull();
    expect(releaseDateFromTag("May 2019")).toBeNull();
    expect(yearOfReleaseDate("2019-05-14")).toBe(2019);
    expect(yearOfReleaseDate(null)).toBeUndefined();
  });

  it("rejects empty titles, unknown fields and bad lyrics", () => {
    expect(() => normalizeTrackPatch({ title: " " })).toThrow(/Title/);
    expect(() => normalizeTrackPatch({ duration: 3 })).toThrow(/not editable/);
    expect(() => normalizeTrackPatch({ lyrics_synced: [{ time: "x", text: 1 }] })).toThrow(TrackEditError);
    expect(normalizeTrackPatch({ lyrics_synced: [] })).toEqual({ lyrics_synced: null });
  });

  it("validates cover keys", () => {
    const key = `users/00000000-0000-4000-8000-00000000000a/art/${"c".repeat(64)}.jpg`;
    expect(normalizeTrackPatch({ artwork_key: key })).toEqual({ artwork_key: key });
    expect(normalizeTrackPatch({ artwork_key: null })).toEqual({ artwork_key: null });
    expect(() => normalizeTrackPatch({ artwork_key: "cover.jpg" })).toThrow(TrackEditError);
  });
});

describe("overlayTrackEdits / diffTrackFields / isValidTrackPatch", () => {
  it("overlays queued edits in order and skips invalid ones", () => {
    const row = overlayTrackEdits(golden.row, [
      { patch: { title: "First" }, editedAt: "2026-10-11T10:00:00.000Z" },
      { patch: { duration: 1 } as TrackEditPatch, editedAt: "2026-10-11T11:00:00.000Z" },
      { patch: { title: "Second", genre: "Rock" }, editedAt: "2026-10-11T12:00:00.000Z" },
    ]);
    expect(row.title).toBe("Second");
    expect(row.genre).toBe("Rock");
  });

  it("diffs only changed editable fields", () => {
    expect(diffTrackFields(golden.row, { title: "Original", genre: "Rock", release_date: "2001", language: null })).toEqual({
      genre: "Rock",
    });
  });

  it("recognises queueable patches", () => {
    expect(isValidTrackPatch({ title: "x" })).toBe(true);
    expect(isValidTrackPatch({})).toBe(false);
    expect(isValidTrackPatch({ title: " " })).toBe(false);
    expect(isValidTrackPatch({ codec: "mp3" })).toBe(false);
  });
});
