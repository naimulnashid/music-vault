import { useId, useRef, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "./ui/useModalFocus";
import { CloudOff, Loader2, X } from "lucide-react";
import { formatTime, type EditableTrackField, type PreparedCover } from "@musicvault/core";
import { useUiStore } from "../store/uiStore";
import { useLibraryStore } from "../store/libraryStore";
import { useAuthStore } from "../store/authStore";
import { putBlob, vaultApi } from "../lib/vault";
import { adoptVaultCover } from "../lib/artwork";
import { coverPreviewUrl, type WebCoverHandle } from "../lib/uploadPrepare";
import { confirmDeleteFromVault } from "../lib/vaultActions";
import { commonValues, EDITOR_FIELDS, patchInput, valuesFromTrack, type FormValues } from "../lib/trackForm";
import { CoverControl, FieldInput, FieldSuggestions } from "./TrackFields";
import type { Track } from "../types";

/**
 * Edit track details — for one track, or several at once (an album). Details
 * live online: saving queues a track.edit per track (field-level LWW), so the
 * change reaches every device. Length, format and other facts read from the
 * audio are shown but can't be changed.
 */

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function ReadOnlyFacts({ track }: { track: Track }) {
  const facts: [string, string | undefined][] = [
    ["Length", formatTime(track.duration)],
    ["Format", track.codec],
    ["Sample rate", track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : undefined],
    ["Bit depth", track.bitDepth ? `${track.bitDepth}-bit` : undefined],
    ["Channels", track.channels ? String(track.channels) : undefined],
    ["File size", track.fileSize ? formatBytes(track.fileSize) : undefined],
    ["ReplayGain", track.replayGainTrack !== undefined ? `${track.replayGainTrack.toFixed(2)} dB` : undefined],
    ["Original file", track.fileName],
    ["Where", "In your vault"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {facts
        .filter(([, v]) => v)
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="truncate" title={value}>
              {value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

/** Uploads a picked cover to the vault and returns its artwork key. */
async function uploadCover(cover: PreparedCover): Promise<string> {
  const vault = vaultApi();
  const session = useAuthStore.getState().session;
  if (!vault || !session) throw new Error("Sign in to change covers");
  const handle = cover.handle as WebCoverHandle;
  const full = await vault.signPutArt(cover.sha256, "full", cover.fullSize);
  await putBlob(full.url, handle.full, "image/jpeg");
  const thumb = await vault.signPutArt(cover.sha256, "thumb", cover.thumbSize);
  await putBlob(thumb.url, handle.thumb, "image/jpeg");
  await adoptVaultCover(full.key, handle.full, handle.thumb);
  return full.key;
}

export function TrackEditor() {
  const ids = useUiStore((s) => s.editorTrackIds);
  const close = useUiStore((s) => s.closeEditor);
  const allTracks = useLibraryStore((s) => s.tracks);
  const tracks = useMemo(() => allTracks.filter((t) => ids?.includes(t.id)), [allTracks, ids]);
  const single = tracks.length === 1 ? tracks[0] : null;

  const initial = useMemo<FormValues>(() => (single ? valuesFromTrack(single) : commonValues(tracks)), [single, tracks]);
  const [values, setValues] = useState<FormValues>(initial);
  const [touched, setTouched] = useState<Set<EditableTrackField>>(new Set());
  // undefined = unchanged, null = remove, PreparedCover = replace
  const [cover, setCover] = useState<PreparedCover | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the dialog opens for different tracks.
  useEffect(() => {
    setValues(initial);
    setTouched(new Set());
    setCover(undefined);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(panel, Boolean(ids) && tracks.length > 0, busy ? undefined : close);

  if (!ids || tracks.length === 0) return null;

  const inVault = tracks.filter((t) => t.storageKey);
  const previewUrl = cover ? coverPreviewUrl(cover) : undefined;
  const differing = (field: EditableTrackField) =>
    !single && (initial[field] ?? "") === "" && tracks.some((t) => (valuesFromTrack(t)[field] ?? "") !== "");

  const onChange = (field: EditableTrackField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setTouched((t) => new Set(t).add(field));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Single track: what differs from its current details. Several: only
      // the fields the user actually touched (blank = clear for all).
      const fields = single
        ? EDITOR_FIELDS.filter((f) => (values[f] ?? "") !== (initial[f] ?? ""))
        : [...touched];
      const input = patchInput(values, fields);
      if (cover !== undefined) input.artwork_key = cover ? await uploadCover(cover) : null;
      if (Object.keys(input).length > 0) useLibraryStore.getState().editTracks(ids, input);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (await confirmDeleteFromVault(inVault)) close();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-sm p-4 animate-fade-in" onClick={busy ? undefined : close}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-surface border border-line shadow-[0_24px_80px_-16px_rgb(0_0_0/0.6)] animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <FieldSuggestions />
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
          <h2 id={titleId} className="text-lg font-bold flex-1 truncate">
            {single ? `Edit “${single.title}”` : `Edit ${tracks.length} tracks`}
          </h2>
          <button aria-label="Close" onClick={close} disabled={busy} className="text-muted hover:text-fg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!single && (
            <p className="text-xs text-muted mb-3">
              Only the fields you change are applied to all {tracks.length} tracks. Fields marked “Multiple values” stay as they are unless you type in them.
            </p>
          )}
          <div className="flex gap-5">
            <CoverControl
              previewUrl={previewUrl}
              trackId={cover === undefined ? single?.id : undefined}
              hasCover={cover === undefined && Boolean(single)}
              disabled={busy}
              onPick={setCover}
              onRemove={() => setCover(null)}
              onError={setError}
            />
            <div className="flex-1 grid grid-cols-2 gap-2">
              {EDITOR_FIELDS.filter((f) => f !== "lyrics_text" && f !== "lyrics_synced").map((field) => (
                <FieldInput
                  key={field}
                  field={field}
                  values={values}
                  onChange={onChange}
                  placeholder={differing(field) && !touched.has(field) ? "Multiple values" : undefined}
                  className={field === "title" ? "col-span-2" : undefined}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <FieldInput field="lyrics_text" values={values} onChange={onChange} placeholder={differing("lyrics_text") ? "Multiple values" : undefined} />
            <FieldInput field="lyrics_synced" values={values} onChange={onChange} placeholder={differing("lyrics_synced") ? "Multiple values" : undefined} />
          </div>
          {single && (
            <section className="mt-5 pt-4 border-t border-line">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">From the audio file</h3>
              <ReadOnlyFacts track={single} />
            </section>
          )}
          {error && <p className="text-xs text-danger mt-3">{error}</p>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-line">
          {inVault.length > 0 && (
            <button
              onClick={() => void remove()}
              disabled={busy}
              className="flex items-center gap-2 h-10 px-4 rounded-full text-sm font-semibold text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
            >
              <CloudOff className="w-4 h-4" /> Delete from vault
            </button>
          )}
          <div className="flex-1" />
          <button onClick={close} disabled={busy} className="h-10 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface-2 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="flex items-center gap-2 h-10 px-5 rounded-full text-sm font-semibold bg-accent text-accent-fg hover:bg-accent-hover active:scale-[0.97] transition-[background-color,transform] disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
