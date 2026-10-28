import type { EditableTrackField } from "./trackFields";

/**
 * Song details pasted as JSON into the upload screen (docs/upload-json.md).
 * One song is an object, several are an array of them. Values are strings;
 * fields that hold several names (artists, genres, moods, languages,
 * countries) may also be arrays, which become "A, B". Release dates may be a
 * number (a year). Missing, null or empty values leave the field as it is.
 *
 * Names from a metadata research file are understood too (`track_title`,
 * `primary_genre`, `vocal_type`, `plain_lyrics`, `synchronized_lyrics`,
 * `languages`); anything else, such as cover or lyrics links, is ignored.
 */

/** What the template lists, in upload-form order. */
export const UPLOAD_JSON_TEMPLATE = {
  title: "",
  artist: "",
  featured_artists: "",
  album: "",
  genre: "",
  subgenre: "",
  secondary_genres: "",
  mood: "",
  vocals: "",
  language: "",
  country: "",
  release_date: "YYYY-MM-DD",
  lyrics: "",
  synced_lyrics: "[00:12.00] First line\n[00:15.50] Second line",
};

/** Form values for one pasted song, keyed like the upload form (lyrics_synced as LRC text). */
export type PastedSong = Partial<Record<EditableTrackField, string>>;

export interface ParsedUploadJson {
  songs: PastedSong[];
  /** Keys present in the paste that no field takes, for the "ignored" note. */
  ignored: string[];
}

/** JSON key → form field. When two keys fill one field, the earlier one here wins. */
const KEYS: [string, EditableTrackField][] = [
  ["title", "title"],
  ["track_title", "title"],
  ["artist", "artist"],
  ["featured_artists", "featured_artists"],
  ["album", "album"],
  ["genre", "genre"],
  ["primary_genre", "genre"],
  ["subgenre", "subgenre"],
  ["secondary_genres", "secondary_genres"],
  ["mood", "mood"],
  ["vocals", "vocals"],
  ["vocal_type", "vocals"],
  ["language", "language"],
  ["languages", "language"],
  ["country", "country"],
  ["release_date", "release_date"],
  ["lyrics", "lyrics_text"],
  ["lyrics_text", "lyrics_text"],
  ["plain_lyrics", "lyrics_text"],
  ["synced_lyrics", "lyrics_synced"],
  ["lyrics_synced", "lyrics_synced"],
  ["synchronized_lyrics", "lyrics_synced"],
];
const FIELD_OF = new Map(KEYS);

/** A pasted value as form text, or null when it says nothing. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
    return parts.length > 0 ? [...new Set(parts)].join(", ") : null;
  }
  return null;
}

/** The template's own placeholders, so pasting it unchanged fills nothing. */
const PLACEHOLDERS = new Set(Object.values(UPLOAD_JSON_TEMPLATE).filter((v) => v !== ""));

function songFrom(obj: Record<string, unknown>, ignored: Set<string>): PastedSong {
  for (const key of Object.keys(obj)) if (!FIELD_OF.has(key)) ignored.add(key);
  const out: PastedSong = {};
  for (const [key, field] of KEYS) {
    if (out[field] !== undefined || !(key in obj)) continue;
    const text = asText(obj[key]);
    if (text !== null && !PLACEHOLDERS.has(text)) out[field] = text;
  }
  return out;
}

/** Reads pasted JSON; throws an Error whose message can be shown as it is. */
export function parseUploadJson(text: string): ParsedUploadJson {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON. Paste one song as { … } or several as [ { … }, { … } ].");
  }
  const list = Array.isArray(data) ? data : [data];
  if (list.length === 0 || !list.every((s) => s !== null && typeof s === "object" && !Array.isArray(s))) {
    throw new Error("Paste one song as { … } or several as [ { … }, { … } ].");
  }
  const ignored = new Set<string>();
  const songs = (list as Record<string, unknown>[]).map((s) => songFrom(s, ignored));
  if (songs.every((s) => Object.keys(s).length === 0)) {
    throw new Error("Nothing to fill: none of the pasted keys is a song detail. See the template.");
  }
  return { songs, ignored: [...ignored].sort() };
}

const norm = (s: string | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface UploadRowRef {
  id: string;
  /** The row's title as currently typed. */
  title?: string;
  /** The file's name, matched without its extension when the title doesn't match. */
  fileName?: string;
}

/**
 * Pairs pasted songs with upload rows: by title (accents, case and
 * punctuation aside), else by the file's name; one song and one row pair up
 * whatever their titles. Each row takes at most one song.
 */
export function matchPastedSongs(
  songs: PastedSong[],
  rows: UploadRowRef[],
): { matches: { rowId: string; song: PastedSong }[]; unmatched: PastedSong[] } {
  if (songs.length === 1 && rows.length === 1) return { matches: [{ rowId: rows[0].id, song: songs[0] }], unmatched: [] };
  const free = new Map(rows.map((r) => [r.id, r]));
  const matches: { rowId: string; song: PastedSong }[] = [];
  const unmatched: PastedSong[] = [];
  for (const song of songs) {
    const title = norm(song.title);
    const row =
      (title && [...free.values()].find((r) => norm(r.title) === title)) ||
      (title && [...free.values()].find((r) => norm(r.fileName?.replace(/\.[^.]+$/, "")) === title)) ||
      undefined;
    if (row) {
      free.delete(row.id);
      matches.push({ rowId: row.id, song });
    } else {
      unmatched.push(song);
    }
  }
  return { matches, unmatched };
}
