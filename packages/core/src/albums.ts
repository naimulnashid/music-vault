import type { Track } from "./types";

export interface Album<T extends Track = Track> {
  key: string;
  album: string;
  /** The album artist, the one artist on every song, or "Various Artists". */
  artist: string;
  tracks: T[];
}

export const VARIOUS_ARTISTS = "Various Artists";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Identifies the album a song belongs to. Songs of one album often credit
 * different singers, so the track artist is not part of the key: the album
 * title is, plus the album artist when the tags name one (keeps two
 * same-titled albums by different artists apart). Songs without an album
 * title are grouped per artist.
 */
export function albumKey(track: Pick<Track, "album" | "artist" | "albumArtist">): string {
  const album = norm(track.album);
  if (!album) return `::${norm(track.artist)}`;
  return `${album}::${norm(track.albumArtist ?? "")}`;
}

export function groupAlbums<T extends Track>(tracks: T[]): Album<T>[] {
  const map = new Map<string, Album<T>>();
  for (const track of tracks) {
    const key = albumKey(track);
    let album = map.get(key);
    if (!album) {
      album = { key, album: track.album.trim(), artist: "", tracks: [] };
      map.set(key, album);
    }
    album.tracks.push(track);
  }
  for (const album of map.values()) album.artist = albumArtistOf(album.tracks);
  return [...map.values()].sort((a, b) => a.album.localeCompare(b.album));
}

function albumArtistOf(tracks: Track[]): string {
  const tagged = tracks.find((t) => t.albumArtist?.trim())?.albumArtist?.trim();
  if (tagged) return tagged;
  const artists = new Set(tracks.map((t) => t.artist));
  return artists.size === 1 ? tracks[0].artist : VARIOUS_ARTISTS;
}
