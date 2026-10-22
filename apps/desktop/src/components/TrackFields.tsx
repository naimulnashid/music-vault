import { ImagePlus, Trash2 } from "lucide-react";
import { EDITABLE_TRACK_FIELDS, maskReleaseDate, type EditableTrackField, type PreparedCover } from "@musicvault/core";
import { AlbumArt } from "./AlbumArt";
import { pickCover } from "../lib/covers";
import type { FormValues } from "../lib/trackForm";
import { OPTION_MODE, useFieldOptions, type OptionField } from "../lib/fieldOptions";
import { Combobox } from "./ui/Combobox";

/**
 * Shared form controls for the upload dialog and the track editor: one input
 * per editable field (with suggestions from the library, so "Bangla" stays
 * "Bangla"), and the cover picker.
 */

export const inputClass =
  "w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-transparent hover:bg-surface-3 focus:outline-none focus:border-accent focus:bg-surface-2 placeholder:text-subtle transition-colors";

const LABELS = Object.fromEntries(EDITABLE_TRACK_FIELDS.map((f) => [f.key, f.label])) as Record<EditableTrackField, string>;
const PLACEHOLDERS: Partial<Record<EditableTrackField, string>> = { release_date: "YYYY-MM-DD" };

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
  const suggested = field in OPTION_MODE ? (field as OptionField) : null;
  const options = useFieldOptions(suggested ?? "title");
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
  // Title has suggestions in smart rules only; here it is a plain input.
  if (suggested && field !== "title") {
    return (
      <label className={`block ${className ?? ""}`}>
        <span className="text-xs font-semibold text-muted">{label}</span>
        <Combobox
          value={value}
          onChange={(v) => onChange(field, v)}
          options={options}
          {...OPTION_MODE[suggested]}
          placeholder={placeholder}
          className="mt-1"
          inputClassName={inputClass}
        />
      </label>
    );
  }
  const isDate = field === "release_date";
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(field, isDate ? maskReleaseDate(value, e.target.value) : e.target.value)}
        placeholder={placeholder ?? PLACEHOLDERS[field]}
        inputMode={isDate ? "numeric" : undefined}
        maxLength={isDate ? 10 : undefined}
        className={`${inputClass} mt-1`}
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
