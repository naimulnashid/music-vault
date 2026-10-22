import type { TrackRow } from "./supabase/database.types";
import type { LyricLine } from "./types";

/**
 * Track metadata editing (docs/drive-to-r2-migration.md §2.2, §2.5).
 *
 * The online `tracks` row is the source of truth for descriptive metadata.
 * Descriptive fields are editable from every client; technical properties
 * read from the audio are not. `applyTrackEdit` is a pure mirror of the
 * `public.apply_track_edit` SQL function — field-level last-writer-wins —
 * and is pinned, together with its Kotlin port (data/sync/TrackEdit.kt), by
 * docs/fixtures/track-edit.golden.json. Change all three in lockstep.
 */

export type EditableTrackField =
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "language"
  | "country"
  | "release_date"
  | "lyrics_text"
  | "lyrics_synced"
  | "artwork_key";

export type ReadOnlyTrackField =
  | "content_hash"
  | "file_name"
  | "file_size"
  | "duration"
  | "codec"
  | "sample_rate"
  | "bit_depth"
  | "channels"
  | "replaygain_track_db"
  | "replaygain_album_db";

export type TrackFieldKind = "text" | "multiline" | "date" | "int" | "real" | "lyrics" | "artwork";

export interface TrackFieldMeta<K extends string = string> {
  key: K;
  label: string;
  kind: TrackFieldKind;
}

/** Editor field order and widgets, shared by desktop and web (Android mirrors it). */
export const EDITABLE_TRACK_FIELDS: readonly TrackFieldMeta<EditableTrackField>[] = [
  { key: "title", label: "Title", kind: "text" },
  { key: "artist", label: "Artist", kind: "text" },
  { key: "album", label: "Album", kind: "text" },
  { key: "genre", label: "Genre", kind: "text" },
  { key: "language", label: "Language", kind: "text" },
  { key: "country", label: "Country", kind: "text" },
  { key: "release_date", label: "Release date", kind: "date" },
  { key: "lyrics_text", label: "Lyrics", kind: "multiline" },
  { key: "lyrics_synced", label: "Synced lyrics", kind: "lyrics" },
  { key: "artwork_key", label: "Cover", kind: "artwork" },
];

/** Shown greyed out in the editor; set once from the file at upload. */
export const READ_ONLY_TRACK_FIELDS: readonly TrackFieldMeta<ReadOnlyTrackField>[] = [
  { key: "duration", label: "Length", kind: "real" },
  { key: "codec", label: "Format", kind: "text" },
  { key: "sample_rate", label: "Sample rate", kind: "int" },
  { key: "bit_depth", label: "Bit depth", kind: "int" },
  { key: "channels", label: "Channels", kind: "int" },
  { key: "file_size", label: "File size", kind: "int" },
  { key: "replaygain_track_db", label: "ReplayGain (track)", kind: "real" },
  { key: "replaygain_album_db", label: "ReplayGain (album)", kind: "real" },
  { key: "file_name", label: "Original file name", kind: "text" },
  { key: "content_hash", label: "Content hash", kind: "text" },
];

const EDITABLE = new Set<string>(EDITABLE_TRACK_FIELDS.map((f) => f.key));

/** Fields that are NOT NULL in the schema: a null edit stores "" instead. */
const NOT_NULL_TEXT = new Set<string>(["artist", "album"]);

export type TrackEditPatch = Partial<{
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  language: string | null;
  country: string | null;
  release_date: string | null;
  lyrics_text: string | null;
  lyrics_synced: LyricLine[] | null;
  artwork_key: string | null;
}>;

/**
 * The parts of a track row an edit reads and writes. `year` is not edited
 * directly: it follows `release_date` (the server keeps it in step with a
 * trigger) and stays for sorting, browsing and smart rules.
 */
export type EditableTrackRow = Pick<TrackRow, EditableTrackField | "year" | "user_id" | "field_edited_at">;

export type TrackEditErrorCode =
  | "not_editable"
  | "empty_title"
  | "invalid_value"
  | "invalid_release_date"
  | "invalid_artwork_key";

export class TrackEditError extends Error {
  readonly code: TrackEditErrorCode;
  constructor(code: TrackEditErrorCode, message: string) {
    super(message);
    this.name = "TrackEditError";
    this.code = code;
  }
}

export function isEditableTrackField(key: string): key is EditableTrackField {
  return EDITABLE.has(key);
}

const ARTWORK_KEY = /^users\/([0-9a-f-]{36})\/art\/[0-9a-f]{64}\.jpg$/;

/**
 * A release date as stored: a year, a year and month, or a full date
 * ("2019", "2019-05", "2019-05-14"). The same pattern guards the column in
 * supabase/migrations/0006_release_date_country.sql.
 */
export const RELEASE_DATE = /^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$/;

/**
 * Keeps a release-date input to digits in the YYYY-MM-DD shape while typing:
 * anything but digits is dropped and the hyphens are put in for you, one
 * appearing as soon as the year or the month is complete. `previous` tells
 * typing from deleting, so backspace can remove a hyphen it just passed.
 */
export function maskReleaseDate(previous: string, next: string): string {
  const digits = next.replace(/[^0-9]/g, "").slice(0, 8);
  let out = digits.slice(0, 4);
  if (digits.length > 4) out += `-${digits.slice(4, 6)}`;
  if (digits.length > 6) out += `-${digits.slice(6)}`;
  const typing = next.length > previous.length;
  if (typing && (digits.length === 4 || digits.length === 6)) out += "-";
  return out;
}

/** The year a release date starts with. */
export function yearOfReleaseDate(date: string | null | undefined): number | undefined {
  if (!date || !RELEASE_DATE.test(date)) return undefined;
  return Number(date.slice(0, 4)) || undefined;
}

function isCalendarDate(date: string): boolean {
  if (!RELEASE_DATE.test(date)) return false;
  if (date.length < 10) return true;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/**
 * A tag's date ("2019", "2019-05-14", "2019-05-14T10:00:00", "2019/05/14")
 * as a release date, keeping as much of it as is valid; null when it doesn't
 * start with a year.
 */
export function releaseDateFromTag(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const m = /^\s*([0-9]{4})(?:[-/.]([0-9]{1,2})(?:[-/.]([0-9]{1,2}))?)?/.exec(String(raw));
  if (!m || m[1] === "0000") return null;
  const pad = (v: string) => v.padStart(2, "0");
  const full = m[2] && m[3] ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
  if (full && isCalendarDate(full)) return full;
  const month = m[2] ? `${m[1]}-${pad(m[2])}` : null;
  if (month && RELEASE_DATE.test(month)) return month;
  return m[1];
}

const instant = (iso: string | undefined): number => (iso === undefined ? -Infinity : Date.parse(iso));

/**
 * The checks `apply_track_edit` makes before writing anything: only editable
 * fields, a non-blank title, a well-formed release date, and a cover key
 * under the row owner's prefix.
 */
export function checkTrackEdit(patch: Record<string, unknown>, ownerId: string): void {
  for (const key of Object.keys(patch)) {
    if (!isEditableTrackField(key)) throw new TrackEditError("not_editable", `field ${key} is not editable`);
  }
  if ("title" in patch && (typeof patch.title !== "string" || patch.title.trim() === "")) {
    throw new TrackEditError("empty_title", "title cannot be empty");
  }
  if ("release_date" in patch && patch.release_date !== null) {
    if (typeof patch.release_date !== "string" || !RELEASE_DATE.test(patch.release_date)) {
      throw new TrackEditError("invalid_release_date", "invalid release_date");
    }
  }
  if ("artwork_key" in patch && patch.artwork_key !== null) {
    const m = typeof patch.artwork_key === "string" ? ARTWORK_KEY.exec(patch.artwork_key) : null;
    if (!m || m[1] !== ownerId) throw new TrackEditError("invalid_artwork_key", "invalid artwork_key");
  }
}

/**
 * Applies an edit with field-level last-writer-wins: each field in `patch`
 * is written only if `editedAt` is at least as new as that field's last edit
 * (ties go to the incoming edit). Rejected patches change nothing. Returns a
 * new row; the input is not mutated. Timestamps compare as instants, so the
 * server's "+00:00" formatting and a client's "Z" formatting agree.
 */
export function applyTrackEdit<T extends EditableTrackRow>(row: T, patch: TrackEditPatch, editedAt: string): T {
  const raw = patch as Record<string, unknown>;
  checkTrackEdit(raw, row.user_id);
  const at = instant(editedAt);
  const next: T = { ...row, field_edited_at: { ...row.field_edited_at } };
  const out = next as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (instant(row.field_edited_at[key]) > at) continue;
    const value = raw[key];
    if (key === "title") out.title = (value as string).trim();
    else if (NOT_NULL_TEXT.has(key)) out[key] = value ?? "";
    else out[key] = value ?? null;
    if (key === "release_date") out.year = yearOfReleaseDate(value as string | null) ?? null;
    next.field_edited_at[key] = editedAt;
  }
  return next;
}

/**
 * What the UI shows while edits are still queued: the pulled row with the
 * pending edits (oldest first) applied on top. Invalid edits are skipped.
 */
export function overlayTrackEdits<T extends EditableTrackRow>(
  row: T,
  edits: readonly { patch: TrackEditPatch; editedAt: string }[],
): T {
  let out = row;
  for (const edit of edits) {
    try {
      out = applyTrackEdit(out, edit.patch, edit.editedAt);
    } catch {
      // A malformed queued edit must not hide the rest.
    }
  }
  return out;
}

/** True when `apply_track_edit` would accept the patch's shape (ownership aside). */
export function isValidTrackPatch(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch);
  if (keys.length === 0 || !keys.every(isEditableTrackField)) return false;
  if ("title" in patch && (typeof patch.title !== "string" || patch.title.trim() === "")) return false;
  const date = patch.release_date;
  return !("release_date" in patch) || date === null || (typeof date === "string" && RELEASE_DATE.test(date));
}

/**
 * Turns editor input into a clean patch before it is queued: trims text,
 * maps "" to null on optional fields, parses numbers and range-checks them.
 * Only keys present in `input` appear in the result.
 */
export function normalizeTrackPatch(input: Record<string, unknown>): TrackEditPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isEditableTrackField(key)) throw new TrackEditError("not_editable", `field ${key} is not editable`);
    switch (key) {
      case "title": {
        const title = typeof value === "string" ? value.trim() : "";
        if (!title) throw new TrackEditError("empty_title", "Title cannot be empty");
        out.title = title;
        break;
      }
      case "artist":
      case "album":
        out[key] = typeof value === "string" ? value.trim() : "";
        break;
      case "genre":
      case "language":
      case "country":
        out[key] = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
        break;
      case "lyrics_text":
        out[key] = typeof value === "string" && value.trim() !== "" ? value.replace(/\s+$/, "") : null;
        break;
      case "release_date": {
        // A trailing hyphen is what the input mask leaves after "2019-".
        const date = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/-+$/, "") : "";
        if (date === "") {
          out.release_date = null;
          break;
        }
        if (!isCalendarDate(date)) {
          throw new TrackEditError("invalid_value", "Release date must look like 2019, 2019-05 or 2019-05-14");
        }
        out.release_date = date;
        break;
      }
      case "lyrics_synced": {
        if (value === null || value === undefined) {
          out.lyrics_synced = null;
          break;
        }
        const ok =
          Array.isArray(value) &&
          value.every(
            (l) => l && typeof l === "object" && typeof l.time === "number" && Number.isFinite(l.time) && typeof l.text === "string",
          );
        if (!ok) throw new TrackEditError("invalid_value", "Synced lyrics must be a list of { time, text } lines");
        out.lyrics_synced = value.length > 0 ? value : null;
        break;
      }
      case "artwork_key":
        if (value !== null && (typeof value !== "string" || !ARTWORK_KEY.test(value))) {
          throw new TrackEditError("invalid_artwork_key", "invalid artwork_key");
        }
        out.artwork_key = value;
        break;
    }
  }
  return out as TrackEditPatch;
}

/** The fields whose value differs between two rows — the minimal patch for an editor save. */
export function diffTrackFields(before: EditableTrackRow, after: TrackEditPatch): TrackEditPatch {
  const out: Record<string, unknown> = {};
  const b = before as Record<string, unknown>;
  for (const [key, value] of Object.entries(after)) {
    if (!isEditableTrackField(key)) continue;
    if (JSON.stringify(b[key] ?? null) !== JSON.stringify(value ?? null)) out[key] = value;
  }
  return out as TrackEditPatch;
}
