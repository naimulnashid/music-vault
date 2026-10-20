/** The message shown when a song can't be loaded (Android: playback/PlaybackErrors.kt). */

// What a dropped connection looks like by the time it reaches us: fetch's
// TypeError, supabase-js's FunctionsFetchError, or the native downloader's
// "download failed" (desktop).
const NETWORK_ERROR = /failed to fetch|networkerror|network request failed|load failed|download failed|error sending request|dns/i;

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "";
}

/** Offline gets its own wording: the cause is the connection, not the song. */
export function isOfflineError(err: unknown, online = typeof navigator === "undefined" || navigator.onLine): boolean {
  return !online || NETWORK_ERROR.test(errorText(err));
}

export function playbackErrorMessage(title: string, err: unknown, online?: boolean): string {
  if (isOfflineError(err, online)) return `${title}: Not available offline`;
  const text = errorText(err);
  return text ? `${title}: ${text}` : `${title}: Couldn't play this song`;
}
