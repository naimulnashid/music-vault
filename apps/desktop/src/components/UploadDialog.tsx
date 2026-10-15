import { useState } from "react";
import { AlertCircle, CheckCircle2, FilePlus2, Link2, Loader2, UploadCloud, X } from "lucide-react";
import { formatTime } from "@musicvault/core";
import { useUploadStore, type UploadItem } from "../store/uploadStore";
import { SHARED_FIELDS, UPLOAD_FORM_FIELDS } from "../lib/trackForm";
import { CoverControl, FieldInput, FieldSuggestions } from "./TrackFields";
import { stagedArtworkPath } from "../lib/covers";

/**
 * "Upload to your vault": pick or drop files, review/edit what each file's
 * tags say, optionally set album-wide fields and a cover once, then upload.
 * Nothing leaves the device until the user presses Upload.
 */

const STAGE_TEXT: Record<string, string> = {
  resolving: "Checking your library…",
  cover: "Uploading cover…",
  saving: "Saving details…",
  uploading: "Uploading…",
  committing: "Finishing…",
  done: "Done",
};

function percent(item: UploadItem): number | null {
  if (!item.total || item.sent === undefined) return null;
  return Math.min(100, Math.round((item.sent / item.total) * 100));
}

function StatusLine({ item }: { item: UploadItem }) {
  switch (item.status) {
    case "preparing":
      return (
        <span className="flex items-center gap-1 text-xs text-muted">
          <Loader2 className="w-3 h-3 animate-spin" /> Reading file…
        </span>
      );
    case "invalid":
    case "failed":
      return (
        <span className="flex items-center gap-1 text-xs text-danger">
          <AlertCircle className="w-3 h-3 shrink-0" /> {item.error}
        </span>
      );
    case "queued":
      return <span className="text-xs text-muted">Waiting…</span>;
    case "uploading": {
      const pct = item.stage === "uploading" ? percent(item) : null;
      return (
        <span className="flex items-center gap-1 text-xs text-muted">
          <Loader2 className="w-3 h-3 animate-spin" /> {STAGE_TEXT[item.stage ?? "resolving"]}
          {pct !== null && ` ${pct}%`}
        </span>
      );
    }
    case "done":
      return (
        <span className="flex items-center gap-1 text-xs text-accent">
          <CheckCircle2 className="w-3 h-3" />
          {item.outcome?.status === "already-in-vault"
            ? "Already in your vault"
            : item.outcome?.status === "linked"
              ? "Uploaded — history kept"
              : "Uploaded"}
        </span>
      );
    default:
      return item.existing ? (
        <span className="flex items-center gap-1 text-xs text-muted">
          <Link2 className="w-3 h-3" /> Matches “{item.existing.title}” — its plays and playlists are kept
        </span>
      ) : null;
  }
}

function ItemRow({ item, sharedCoverPath }: { item: UploadItem; sharedCoverPath?: string | null }) {
  const setValue = useUploadStore((s) => s.setValue);
  const setItemCover = useUploadStore((s) => s.setItemCover);
  const remove = useUploadStore((s) => s.remove);
  const running = useUploadStore((s) => s.running);
  const editable = item.status === "ready" || item.status === "failed";
  const coverPath = sharedCoverPath !== undefined ? sharedCoverPath ?? undefined : item.cover ? stagedArtworkPath(item.cover) : undefined;
  const fileName = item.path.split(/[\\/]/).pop();

  return (
    <div className="rounded-xl bg-surface-2/40 border border-line p-3">
      <div className="flex gap-3">
        {item.source ? (
          <CoverControl
            artworkPath={coverPath}
            size="w-16 h-16"
            disabled={!editable || sharedCoverPath !== undefined}
            onPick={(c) => setItemCover(item.id, c)}
            onRemove={() => setItemCover(item.id, null)}
          />
        ) : (
          <div className="w-16 h-16 rounded-md bg-surface-2 shrink-0" />
        )}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="truncate" title={item.path}>
              {fileName}
            </span>
            {item.source && <span className="shrink-0">· {formatTime(item.source.technical.duration)}</span>}
            <div className="flex-1" />
            {!running && item.status !== "uploading" && (
              <button onClick={() => remove(item.id)} title="Remove from this upload" className="hover:text-fg">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {item.source && (
            <div className="grid grid-cols-2 gap-2">
              <FieldInput field="title" values={item.values} onChange={(f, v) => setValue(item.id, f, v)} />
              <FieldInput field="artist" values={item.values} onChange={(f, v) => setValue(item.id, f, v)} />
            </div>
          )}
          <StatusLine item={item} />
          {item.status === "uploading" && item.stage === "uploading" && (
            <div className="h-1 rounded bg-surface-2 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${percent(item) ?? 0}%` }} />
            </div>
          )}
        </div>
      </div>
      {item.source && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          {UPLOAD_FORM_FIELDS.filter((f) => f !== "title" && f !== "artist").map((field) => (
            <FieldInput key={field} field={field} values={item.values} onChange={(f, v) => setValue(item.id, f, v)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function UploadDialog() {
  const isOpen = useUploadStore((s) => s.open);
  const items = useUploadStore((s) => s.items);
  const shared = useUploadStore((s) => s.shared);
  const sharedCover = useUploadStore((s) => s.sharedCover);
  const running = useUploadStore((s) => s.running);
  const { pickFiles, setShared, setSharedCover, close, start, clearFinished } = useUploadStore.getState();
  const [coverError, setCoverError] = useState<string | null>(null);

  if (!isOpen) return null;

  const uploadable = items.filter((i) => i.status === "ready" || i.status === "failed");
  const withSource = items.filter((i) => i.source);
  const done = items.filter((i) => i.status === "done").length;
  const sharedCoverPath = sharedCover === undefined ? undefined : sharedCover ? stagedArtworkPath(sharedCover) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-sm p-4 animate-fade-in" onClick={close}>
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-surface border border-line shadow-[0_24px_80px_-16px_rgb(0_0_0/0.6)] animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <FieldSuggestions />
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
          <UploadCloud className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-bold flex-1">Upload to your vault</h2>
          <button
            onClick={() => void pickFiles()}
            disabled={running}
            className="flex items-center gap-2 h-9 px-4 rounded-full text-sm font-semibold bg-surface-2 hover:bg-surface-3 transition-colors disabled:opacity-50"
          >
            <FilePlus2 className="w-4 h-4" /> Add files
          </button>
          <button onClick={close} title={running ? "Hide (uploads continue)" : "Close"} className="text-muted hover:text-fg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {items.length === 0 && (
            <div className="py-10 text-center text-sm text-muted">
              <p className="mb-1">Drop music files or folders onto the window, or use “Add files”.</p>
              <p>You'll review each song's details before anything uploads.</p>
            </div>
          )}

          {withSource.length > 1 && (
            <section className="rounded-xl bg-accent-soft/40 border border-accent/30 p-4">
              <h3 className="text-sm font-medium mb-1">For all {withSource.length} files</h3>
              <p className="text-xs text-muted mb-3">
                Anything you fill in here replaces each file's own value. Leave a field blank to keep them.
              </p>
              <div className="flex gap-4">
                <div className="flex flex-col items-center gap-1">
                  <CoverControl
                    artworkPath={sharedCoverPath ?? undefined}
                    size="w-20 h-20"
                    disabled={running}
                    onPick={(c) => setSharedCover(c)}
                    onRemove={() => setSharedCover(null)}
                    removeLabel="Upload all without a cover"
                    onError={setCoverError}
                  />
                  {sharedCover !== undefined && (
                    <button onClick={() => setSharedCover(undefined)} className="text-[10px] text-muted hover:underline">
                      Use each file's cover
                    </button>
                  )}
                </div>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SHARED_FIELDS.map((field) => (
                    <FieldInput key={field} field={field} values={shared} onChange={setShared} placeholder="Keep each file's" />
                  ))}
                </div>
              </div>
              {coverError && <p className="text-xs text-danger mt-2">{coverError}</p>}
            </section>
          )}

          {items.map((item) => (
            <ItemRow key={item.id} item={item} sharedCoverPath={sharedCoverPath} />
          ))}
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-t border-line">
          <span className="text-xs text-muted flex-1">
            {running
              ? `Uploading… ${done} of ${done + uploadable.length + items.filter((i) => i.status === "uploading" || i.status === "queued").length} done`
              : done > 0
                ? `${done} uploaded`
                : `${uploadable.length} ready`}
          </span>
          {done > 0 && !running && (
            <button onClick={clearFinished} className="h-10 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface-2 transition-colors">
              Clear finished
            </button>
          )}
          <button
            onClick={() => void start()}
            disabled={running || uploadable.length === 0}
            className="flex items-center gap-2 h-10 px-5 rounded-full text-sm font-semibold bg-accent text-accent-fg hover:bg-accent-hover active:scale-[0.97] transition-[background-color,transform] disabled:opacity-50"
          >
            <UploadCloud className="w-4 h-4" />
            {running ? "Uploading…" : `Upload ${uploadable.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
