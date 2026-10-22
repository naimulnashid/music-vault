import { errorText, isOfflineError } from "./playbackError";

export interface DownloadFailure {
  title: string;
  err: unknown;
}

/**
 * One message for a whole download run, so "Download all" while offline shows
 * one toast instead of one per song. Null when nothing failed.
 */
export function downloadFailureMessage(failures: DownloadFailure[], online?: boolean): string | null {
  const last = failures.at(-1);
  if (!last) return null;
  const reason = isOfflineError(last.err, online) ? "Can't download while offline" : errorText(last.err) || "Download failed";
  return failures.length === 1 ? `${last.title}: ${reason}` : `Couldn't download ${failures.length} songs: ${reason}`;
}

/** After moving downloads to another folder: the ones left behind. Null when all moved. */
export function moveFailureMessage(failed: number): string | null {
  if (failed <= 0) return null;
  const what = failed === 1 ? "1 download couldn't move and still plays" : `${failed} downloads couldn't move and still play`;
  return `${what} from the old folder (in use, or the new folder is full). Choose the folder again to retry.`;
}
