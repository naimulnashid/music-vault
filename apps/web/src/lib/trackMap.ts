import {
  overlayTrackEdits,
  trackRefKeys,
  yearOfReleaseDate,
  type SyncOp,
  type TrackEditPatch,
  type TrackRow,
} from "@musicvault/core";
import type { Track } from "../types";

/** Projects a Supabase tracks row into the web Track shape. */
export function trackFromRow(row: TrackRow): Track {
  return {
    id: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    title: row.title || row.file_name.replace(/\.[^.]+$/, ""),
    artist: row.artist ?? "",
    album: row.album ?? "",
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
    replayGainTrack: row.replaygain_track_db ?? undefined,
    replayGainAlbum: row.replaygain_album_db ?? undefined,
    contentHash: row.content_hash ?? undefined,
    lyricsText: row.lyrics_text ?? undefined,
    lyricsSynced: row.lyrics_synced ?? undefined,
    addedAt: Date.parse(row.created_at) || Date.now(),
    codec: row.codec ?? undefined,
    bitDepth: row.bit_depth ?? undefined,
    channels: row.channels ?? undefined,
    storageKey: row.storage_key ?? undefined,
    artworkKey: row.artwork_key ?? undefined,
  };
}

/** Applies an edit patch (Supabase column names) to a library Track. */
export function applyPatchToTrack(track: Track, patch: TrackEditPatch): Track {
  const t: Track = { ...track };
  for (const [field, raw] of Object.entries(patch)) {
    const v = raw ?? undefined;
    switch (field) {
      case "title":
        t.title = (v as string) ?? t.title;
        break;
      case "artist":
        t.artist = (v as string) ?? "";
        break;
      case "album":
        t.album = (v as string) ?? "";
        break;
      case "genre":
        t.genre = v as string | undefined;
        break;
      case "language":
        t.language = v as string | undefined;
        break;
      case "country":
        t.country = v as string | undefined;
        break;
      case "featured_artists":
        t.featuredArtists = v as string | undefined;
        break;
      case "subgenre":
        t.subgenre = v as string | undefined;
        break;
      case "secondary_genres":
        t.secondaryGenres = v as string | undefined;
        break;
      case "mood":
        t.mood = v as string | undefined;
        break;
      case "vocals":
        t.vocals = v as string | undefined;
        break;
      case "release_date":
        t.releaseDate = v as string | undefined;
        t.year = yearOfReleaseDate(v as string | undefined);
        break;
      case "lyrics_text":
        t.lyricsText = v as string | undefined;
        break;
      case "lyrics_synced":
        t.lyricsSynced = v as Track["lyricsSynced"];
        break;
      case "artwork_key":
        t.artworkKey = v as string | undefined;
        break;
    }
  }
  return t;
}

/** A track.edit still queued in the outbox. */
export interface PendingTrackEdit {
  keys: string[];
  patch: TrackEditPatch;
  editedAt: string;
}

export function pendingTrackEdits(ops: SyncOp[]): PendingTrackEdit[] {
  return ops.flatMap(({ payload: p }) =>
    p.kind === "track.edit" ? [{ keys: trackRefKeys(p.track), patch: p.patch, editedAt: p.editedAt }] : [],
  );
}

/**
 * The library's tracks from shadowed rows: only rows with audio in the vault
 * (tombstones and unfinished uploads are dropped), with queued edits laid
 * over them so they show before they flush (field-level LWW, the same rule
 * the server applies).
 */
export function projectRows(rows: TrackRow[], pending: PendingTrackEdit[]): Track[] {
  return rows
    .filter((row) => !row.deleted_at && row.storage_key)
    .map((row) => {
      const keys = new Set([`remote:${row.id}`]);
      if (row.content_hash) keys.add(`hash:${row.content_hash}`);
      const edits = pending
        .filter((e) => e.keys.some((k) => keys.has(k)))
        .sort((a, b) => a.editedAt.localeCompare(b.editedAt));
      return trackFromRow(edits.length > 0 ? overlayTrackEdits(row, edits) : row);
    });
}
