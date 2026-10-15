import { useMemo } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { EDITABLE_TRACK_FIELDS, type EditableTrackField, type PreparedCover } from "@musicvault/core";
import { AlbumArt } from "./AlbumArt";
import { useLibraryStore } from "../store/libraryStore";
import { pickCover } from "../lib/covers";
import type { FormValues } from "../lib/trackForm";

/**
 * Shared form controls for the upload dialog and the track editor: one input
 * per editable field (with suggestions from the library, so "Bangla" stays
 * "Bangla"), and the cover picker.
 */

export const inputClass =
  "w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-transparent hover:bg-surface-3 focus:outline-none focus:border-accent focus:bg-surface-2 placeholder:text-subtle transition-colors";

const LABELS = Object.fromEntries(EDITABLE_TRACK_FIELDS.map((f) => [f.key, f.label])) as Record<EditableTrackField, string>;
const SUGGESTED: EditableTrackField[] = ["artist", "album", "genre", "language", "country"];
/** Fields whose suggestions open from a drop-down arrow; the rest only suggest while typing. */
const DROPDOWN = new Set<EditableTrackField>(["language", "country"]);
const PLACEHOLDERS: Partial<Record<EditableTrackField, string>> = { release_date: "YYYY-MM-DD" };

/** Distinct values already in the library, per suggestible field. */
export function FieldSuggestions() {
  const tracks = useLibraryStore((s) => s.tracks);
  const lists = useMemo(() => {
    const sets: Record<string, Set<string>> = Object.fromEntries(SUGGESTED.map((f) => [f, new Set<string>()]));
    for (const t of tracks) {
      if (t.artist && t.artist !== "Unknown Artist") sets.artist.add(t.artist);
      if (t.album && t.album !== "Unknown Album") sets.album.add(t.album);
      if (t.genre) sets.genre.add(t.genre);
      if (t.language) sets.language.add(t.language);
      if (t.country) sets.country.add(t.country);
    }
    return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, [...v].sort((a, b) => a.localeCompare(b))]));
  }, [tracks]);
  return (
    <>
      {SUGGESTED.map((field) => (
        <datalist key={field} id={`mv-suggest-${field}`}>
          {lists[field].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}
    </>
  );
}

export function FieldInput({
  field,
  values,
  onChange,
  placeholder,
  className,
}: {
  field: EditableTrackField;
  values: FormValues;
  onChange: (field: EditableTrackField, value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const value = values[field] ?? "";
  const label = LABELS[field];
  if (field === "lyrics_text" || field === "lyrics_synced") {
    return (
      <label className={`block ${className ?? ""}`}>
        <span className="text-xs font-semibold text-muted">
          {field === "lyrics_synced" ? "Synced lyrics (LRC: [mm:ss.xx] line)" : label}
        </span>
        <textarea
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder={placeholder}
          rows={5}
          spellCheck={false}
          className={`${inputClass} font-mono text-xs resize-y mt-1`}
        />
      </label>
    );
  }
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        placeholder={placeholder ?? PLACEHOLDERS[field]}
        list={SUGGESTED.includes(field) ? `mv-suggest-${field}` : undefined}
        className={`${inputClass} mt-1 ${DROPDOWN.has(field) ? "" : "mv-no-picker"}`}
      />
    </label>
  );
}

export function CoverControl({
  artworkPath,
  onPick,
  onRemove,
  removeLabel = "Remove cover",
  size = "w-28 h-28",
  disabled,
  onError,
}: {
  artworkPath?: string;
  onPick: (cover: PreparedCover) => void;
  onRemove?: () => void;
  removeLabel?: string;
  size?: string;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const choose = async () => {
    try {
      const cover = await pickCover();
      if (cover) onPick(cover);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <AlbumArt artworkPath={artworkPath} className={`${size} rounded-lg object-cover`} />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void choose()}
          title="Choose a cover image"
          className="flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-semibold bg-surface-2 hover:bg-surface-3 transition-colors disabled:opacity-50"
        >
          <ImagePlus className="w-3.5 h-3.5" /> Cover
        </button>
        {onRemove && artworkPath && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            title={removeLabel}
            className="p-1 rounded-md text-muted hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
