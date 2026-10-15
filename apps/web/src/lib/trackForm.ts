import {
  parseLrc,
  type EditableTrackField,
  type LyricLine,
  type TrackEditPatch,
  type TrackRow as RemoteTrackRow,
} from "@musicvault/core";
import type { Track } from "../types";

/**
 * Editor/upload form plumbing: form inputs hold strings; these helpers move
 * between Tracks, patches and form values. Validation and normalisation stay
 * in core (normalizeTrackPatch) so every client accepts the same input.
 */

export type FormValues = Partial<Record<EditableTrackField, string>>;

/** Fields shown in the upload form (lyrics come from the file and are edited later). */
export const UPLOAD_FORM_FIELDS: EditableTrackField[] = [
  "title",
  "artist",
  "album",
  "genre",
  "language",
  "country",
  "release_date",
];

/** Fields that can be set once for a whole batch / album. */
export const SHARED_FIELDS: EditableTrackField[] = ["artist", "album", "genre", "language", "country", "release_date"];

/** Fields shown in the track editor (the cover has its own control). */
export const EDITOR_FIELDS: EditableTrackField[] = [...UPLOAD_FORM_FIELDS, "lyrics_text", "lyrics_synced"];

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, "0");

/** Synced lyrics → LRC text ("[mm:ss.xx]line"). */
export function lrcFromLines(lines: LyricLine[] | null | undefined): string {
  if (!lines || lines.length === 0) return "";
  return lines
    .map((l) => {
      const centis = Math.round((l.time % 1) * 100) % 100;
      return `[${pad(l.time / 60)}:${pad(l.time % 60)}.${pad(centis)}]${l.text}`;
    })
    .join("\n");
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export function valuesFromPatch(patch: TrackEditPatch): FormValues {
  const out: FormValues = {};
  for (const [key, value] of Object.entries(patch)) {
    out[key as EditableTrackField] = key === "lyrics_synced" ? lrcFromLines(value as LyricLine[]) : str(value);
  }
  return out;
}

export function valuesFromTrack(t: Track): FormValues {
  return {
    title: t.title,
    artist: t.artist === "Unknown Artist" ? "" : t.artist,
    album: t.album === "Unknown Album" ? "" : t.album,
    genre: str(t.genre),
    language: str(t.language),
    country: str(t.country),
    release_date: str(t.releaseDate),
    lyrics_text: str(t.lyricsText),
    lyrics_synced: lrcFromLines(t.lyricsSynced),
  };
}

/** Form values from a canonical online row (a re-upload starts from these). */
export function valuesFromRow(row: RemoteTrackRow): FormValues {
  return {
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: str(row.genre),
    language: str(row.language),
    country: str(row.country),
    release_date: str(row.release_date),
    lyrics_text: str(row.lyrics_text),
    lyrics_synced: lrcFromLines(row.lyrics_synced),
  };
}

/** The values every track shares; a field whose tracks disagree is left blank. */
export function commonValues(tracks: Track[]): FormValues {
  if (tracks.length === 0) return {};
  const all = tracks.map(valuesFromTrack);
  const out: FormValues = {};
  for (const field of EDITOR_FIELDS) {
    const first = all[0][field] ?? "";
    out[field] = all.every((v) => (v[field] ?? "") === first) ? first : "";
  }
  return out;
}

/** Raw patch input for normalizeTrackPatch from the chosen form fields. */
export function patchInput(values: FormValues, fields: Iterable<EditableTrackField>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field] ?? "";
    if (field === "lyrics_synced") {
      const lines = value.trim() ? parseLrc(value) : [];
      out[field] = lines.length > 0 ? lines : null;
    } else {
      out[field] = value;
    }
  }
  return out;
}
