import { describe, expect, it } from "vitest";
import { UPLOAD_JSON_TEMPLATE, matchPastedSongs, parseUploadJson } from "../src/uploadJson";

describe("parseUploadJson", () => {
  it("reads one song and joins list values", () => {
    const { songs, ignored } = parseUploadJson(
      JSON.stringify({ title: "Song", mood: ["Romantic", "Yearning"], release_date: 2019, lyrics: "la la", cover_url: "x" }),
    );
    expect(songs).toEqual([{ title: "Song", mood: "Romantic, Yearning", release_date: "2019", lyrics_text: "la la" }]);
    expect(ignored).toEqual(["cover_url"]);
  });

  it("understands the research file's names, preferring language over languages", () => {
    const { songs } = parseUploadJson(
      JSON.stringify([
        { track_title: "A", primary_genre: "Pop", vocal_type: "Female", languages: ["Hindi", null], language: "Hindi" },
        { track_title: "B", language: null, languages: ["English", "Spanish"], synchronized_lyrics: null },
      ]),
    );
    expect(songs).toEqual([
      { title: "A", genre: "Pop", vocals: "Female", language: "Hindi" },
      { title: "B", language: "English, Spanish" },
    ]);
  });

  it("fills nothing from the template's placeholders", () => {
    expect(() => parseUploadJson(JSON.stringify(UPLOAD_JSON_TEMPLATE))).toThrow(/Nothing to fill/);
  });

  it("explains bad input", () => {
    expect(() => parseUploadJson("{ title: ")).toThrow(/valid JSON/);
    expect(() => parseUploadJson("[1, 2]")).toThrow(/one song/);
  });
});

describe("matchPastedSongs", () => {
  it("pairs one song with one row whatever the titles", () => {
    expect(matchPastedSongs([{ title: "X" }], [{ id: "r1", title: "Y" }]).matches).toEqual([{ rowId: "r1", song: { title: "X" } }]);
  });

  it("matches by title, then by file name, each row once", () => {
    const rows = [
      { id: "r1", title: "Chaad Tara" },
      { id: "r2", title: "", fileName: "Neela.flac" },
    ];
    const { matches, unmatched } = matchPastedSongs([{ title: "neela" }, { title: "Chaad Tara!" }, { title: "Other" }], rows);
    expect(matches).toEqual([
      { rowId: "r2", song: { title: "neela" } },
      { rowId: "r1", song: { title: "Chaad Tara!" } },
    ]);
    expect(unmatched).toEqual([{ title: "Other" }]);
  });
});
