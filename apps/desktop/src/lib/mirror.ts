import { toLrc, type TrackRow as RemoteTrackRow } from "@musicvault/core";
import type { MirrorTrack } from "./ipc";
import { liveRows, storageExt, type PendingTrackEdit } from "./vaultMerge";

/**
 * What the library mirror writes for each live track: its details as stored
 * online (with queued edits), never the display fallbacks a Track gets, so an
 * empty artist stays empty instead of becoming the tag "Unknown Artist".
 */
export function mirrorTracks(rows: RemoteTrackRow[], pending: PendingTrackEdit[]): MirrorTrack[] {
  return liveRows(rows, pending).map((row) => ({
    id: row.id,
    contentHash: row.content_hash!,
    ext: storageExt(row.storage_key!),
    fileSize: row.file_size,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    language: row.language,
    country: row.country,
    releaseDate: row.release_date,
    lyricsText: row.lyrics_text,
    lrc: row.lyrics_synced && row.lyrics_synced.length > 0 ? toLrc(row.lyrics_synced) : null,
    replayGainTrack: row.replaygain_track_db,
    replayGainAlbum: row.replaygain_album_db,
    artworkKey: row.artwork_key,
  }));
}

/** Tracks deleted from the vault: only these leave the mirror. */
export function tombstonedIds(rows: RemoteTrackRow[]): string[] {
  return rows.filter((r) => r.deleted_at).map((r) => r.id);
}

const songs = (n: number) => `${n.toLocaleString()} ${n === 1 ? "song" : "songs"}`;

function formatGb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

/** Why a run can't start for lack of space, or null when it fits. */
export function spaceShortfall(bytesNeeded: number, freeBytes: number | null): string | null {
  if (freeBytes === null || bytesNeeded <= freeBytes) return null;
  return `Not enough space on the mirror folder's drive: ${formatGb(bytesNeeded)} needed, ${formatGb(freeBytes)} free.`;
}

export interface MirrorRunResult {
  /** Songs in the mirror when the run ended. */
  total: number;
  failed: number;
  untagged: number;
  /** The first failure's message, for the log line. */
  firstError: string | null;
}

/** The card's line after a run. */
export function runSummary(r: MirrorRunResult): string {
  const parts = [`${songs(r.total)} in the folder`];
  if (r.failed > 0) parts.push(`${songs(r.failed)} couldn't be written and will be tried again`);
  if (r.untagged > 0) parts.push(`${songs(r.untagged)} copied without details (their format can't be tagged)`);
  return parts.join(" • ");
}
