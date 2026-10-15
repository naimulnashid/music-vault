import type { Playlist, Settings } from "../types";
import {
  playlistsCreate,
  playlistsDelete,
  playlistsGetAll,
  playlistsRename,
  playlistsSetRules,
  playlistsSetTracks,
  settingsGet,
  settingsSet,
  type PlaylistRow,
} from "./ipc";
import type { SmartRules } from "@musicvault/core";

/**
 * Data layer over the Rust SQLite backend: playlists and settings in the app
 * data dir's library.db. Tracks come from the vault (sync shadow), not here.
 */

function rowToPlaylist(r: PlaylistRow): Playlist {
  let smartRules: SmartRules | undefined;
  if (r.smartRules) {
    try {
      smartRules = JSON.parse(r.smartRules) as SmartRules;
    } catch (err) {
      console.error(`[db] bad smart rules on playlist ${r.id}:`, err);
    }
  }
  return {
    id: r.id,
    name: r.name,
    trackIds: r.trackIds,
    createdAt: r.createdAt,
    isSmart: r.isSmart,
    smartRules,
  };
}

export async function getAllPlaylists(): Promise<Playlist[]> {
  const rows = await playlistsGetAll();
  return rows.map(rowToPlaylist);
}

export async function createPlaylist(playlist: Playlist): Promise<void> {
  const rules = playlist.smartRules ? JSON.stringify(playlist.smartRules) : undefined;
  await playlistsCreate(playlist.id, playlist.name, playlist.createdAt, rules);
  if (playlist.trackIds.length > 0) await playlistsSetTracks(playlist.id, playlist.trackIds);
}

export async function setPlaylistRules(id: string, rules: SmartRules): Promise<void> {
  await playlistsSetRules(id, JSON.stringify(rules));
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  await playlistsRename(id, name);
}

export async function deletePlaylist(id: string): Promise<void> {
  await playlistsDelete(id);
}

export async function setPlaylistTracks(id: string, trackIds: string[]): Promise<void> {
  await playlistsSetTracks(id, trackIds);
}

export async function getSettings(): Promise<Settings | undefined> {
  const json = await settingsGet();
  if (!json) return undefined;
  try {
    return JSON.parse(json) as Settings;
  } catch {
    return undefined;
  }
}

export async function putSettings(settings: Settings): Promise<void> {
  await settingsSet(JSON.stringify(settings));
}
