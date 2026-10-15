import { Check, Download } from "lucide-react";
import { useCollectionDownload } from "../lib/trackState";
import type { Track } from "../types";
import { ProgressRing } from "./DownloadRing";

/**
 * "Download" toggle for a collection (album / artist / playlist), as in
 * YouTube Music: downloads every song not on this device; while that runs it
 * shows how many are done and a click cancels; once everything is here a
 * click removes the downloads. Hidden when nothing in it is in the vault.
 */
export function DownloadAllButton({ tracks, className }: { tracks: Track[]; className?: string }) {
  const { total, done, active, ratio, download, cancel, remove } = useCollectionDownload(tracks);
  if (total === 0) return null;

  const songs = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;
  const state = active > 0 ? "downloading" : done === total ? "done" : "idle";
  const title =
    state === "downloading"
      ? `Downloaded ${done} of ${total}, ${songs(total - done)} left. Click to cancel.`
      : state === "done"
        ? `All ${songs(total)} are on this device. Click to remove the downloads.`
        : `Download ${songs(total - done)} to this device`;

  return (
    <button
      onClick={state === "downloading" ? cancel : state === "done" ? remove : download}
      title={title}
      className={
        className ??
        "group inline-flex items-center gap-2 h-11 px-5 rounded-full bg-surface-2 hover:bg-surface-3 text-sm font-semibold active:scale-[0.97] transition-[background-color,transform]"
      }
    >
      {state === "downloading" ? (
        <ProgressRing ratio={ratio} size={18} />
      ) : state === "done" ? (
        <Check className="w-4 h-4 text-accent" strokeWidth={3} />
      ) : (
        <Download className="w-4 h-4" />
      )}
      {state === "downloading" ? (
        <>
          <span className="tabular-nums group-hover:hidden">
            {done} of {total}
          </span>
          <span className="hidden group-hover:inline">Cancel</span>
        </>
      ) : state === "done" ? (
        <>
          <span className="group-hover:hidden">Downloaded</span>
          <span className="hidden group-hover:inline">Remove download</span>
        </>
      ) : (
        "Download"
      )}
    </button>
  );
}
