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
