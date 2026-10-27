import { overlayTrackEdits, yearOfReleaseDate, type TrackEditPatch, type TrackRow as RemoteTrackRow } from "@musicvault/core";
import type { Track } from "../types";

/**
 * The library is the vault (docs/drive-to-r2-migration.md §2.5): every live
 * track row with audio in the vault becomes a track, id `vault:<contentHash>`,
 * its metadata exactly as stored online. Edits still queued in the outbox are
 * laid over their rows (field-level LWW, the rule the server applies), so the
 * UI shows them before they flush. Tombstoned rows (`deleted_at`) and uploads
 * that never committed (no `storage_key`) don't produce tracks.
 */

/** A track.edit still in the outbox, with every identity key its ref carries. */
export interface PendingTrackEdit {
  keys: string[];
  patch: TrackEditPatch;
  editedAt: string;
}

const rowKeys = (row: RemoteTrackRow): string[] => {
  const keys = [`remote:${row.id}`];
  if (row.content_hash) keys.push(`hash:${row.content_hash}`);
  return keys;
};

/** The cached artwork file name for a vault cover key (`vault-<sha>.jpg`). */
export function artFileName(artworkKey: string): string | null {
  const m = /\/art\/([0-9a-f]{64})\.jpg$/.exec(artworkKey);
  return m ? `vault-${m[1]}.jpg` : null;
}

/** The audio extension a vault storage key ends in. */
export function storageExt(storageKey: string): string {
  return /\.([a-z0-9]+)$/.exec(storageKey)?.[1] ?? "bin";
}

function vaultTrack(row: RemoteTrackRow, vaultArt: Record<string, string>): Track {
  return {
    id: `vault:${row.content_hash}`,
    path: "",
    remoteId: row.id,
    storageKey: row.storage_key ?? undefined,
    artworkKey: row.artwork_key ?? undefined,
    contentHash: row.content_hash ?? undefined,
    fileName: row.file_name,
    fileSize: row.file_size,
    title: row.title,
    artist: row.artist || "Unknown Artist",
    album: row.album || "Unknown Album",
    albumArtist: row.album_artist ?? undefined,
    genre: row.genre ?? undefined,
    year: yearOfReleaseDate(row.release_date) ?? row.year ?? undefined,
    language: row.language ?? undefined,
    country: row.country ?? undefined,
    featuredArtists: row.featured_artists ?? undefined,
    subgenre: row.subgenre ?? undefined,
    secondaryGenres: row.secondary_genres ?? undefined,
    mood: row.mood ?? undefined,
    vocals: row.vocals ?? undefined,
    releaseDate: row.release_date ?? undefined,
    composer: row.composer ?? undefined,
    trackNo: row.track_no ?? undefined,
    discNo: row.disc_no ?? undefined,
    bpm: row.bpm ?? undefined,
    duration: row.duration,
    sampleRate: row.sample_rate ?? undefined,
    bitDepth: row.bit_depth ?? undefined,
    channels: row.channels ?? undefined,
    codec: row.codec ?? undefined,
    replayGainTrack: row.replaygain_track_db ?? undefined,
    replayGainAlbum: row.replaygain_album_db ?? undefined,
    lyricsText: row.lyrics_text ?? undefined,
    lyricsSynced: row.lyrics_synced ?? undefined,
    artworkPath: row.artwork_key ? vaultArt[row.artwork_key] : undefined,
    addedAt: Date.parse(row.uploaded_at ?? row.created_at) || 0,
  };
}

export function projectVault(
  rows: RemoteTrackRow[],
  pending: PendingTrackEdit[],
  vaultArt: Record<string, string>,
): Track[] {
  return liveRows(rows, pending).map((row) => vaultTrack(row, vaultArt));
}

/**
 * The rows that make tracks, with queued edits laid over them, as stored:
 * without the display fallbacks (such as "Unknown Artist") a Track gets.
 */
export function liveRows(rows: RemoteTrackRow[], pending: PendingTrackEdit[]): RemoteTrackRow[] {
  const editsByKey = new Map<string, PendingTrackEdit[]>();
  for (const edit of pending) {
    for (const key of edit.keys) {
      const list = editsByKey.get(key) ?? [];
      list.push(edit);
      editsByKey.set(key, list);
    }
  }
  const out: RemoteTrackRow[] = [];
  for (const row of rows) {
    if (row.deleted_at || !row.storage_key || !row.content_hash) continue;
    const seen = new Set<PendingTrackEdit>();
    for (const key of rowKeys(row)) for (const e of editsByKey.get(key) ?? []) seen.add(e);
    const edits = [...seen].sort((a, b) => a.editedAt.localeCompare(b.editedAt));
    out.push(edits.length > 0 ? overlayTrackEdits(row, edits) : row);
  }
  return out;
}
