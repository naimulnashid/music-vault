import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface PlaylistRow {
  id: string;
  name: string;
  createdAt: number;
  trackIds: string[];
  isSmart: boolean;
  /** JSON-serialized SmartRules from @musicvault/core. */
  smartRules: string | null;
}

export interface PositionEvent {
  position: number;
  duration: number;
}

export interface StateEvent {
  playing: boolean;
}

export interface AdvancedEvent {
  path: string;
}

export interface DeviceEvent {
  sampleRate: number;
  deviceName: string;
  resampling: boolean;
}

export interface SpectrumEvent {
  freq: number[];
  wave: number[];
}

export interface PlayerErrorEvent {
  message: string;
  path?: string;
}

export interface SmtcControlEvent {
  action: "play" | "pause" | "toggle" | "next" | "prev" | "seek";
  position?: number;
}

// ---- Player commands -------------------------------------------------------

export const playerLoad = (path: string, startAt: number, autoplay: boolean, rgDb: number | null) =>
  invoke<void>("player_load", { path, startAt, autoplay, rgDb });
export const playerPlay = () => invoke<void>("player_play");
export const playerPause = () => invoke<void>("player_pause");
export const playerStop = () => invoke<void>("player_stop");
export const playerSeek = (position: number) => invoke<void>("player_seek", { position });
export const playerSetVolume = (volume: number) => invoke<void>("player_set_volume", { volume });
export const playerSetEq = (bands: number[]) => invoke<void>("player_set_eq", { bands });
export const playerSetCrossfade = (seconds: number) => invoke<void>("player_set_crossfade", { seconds });
export const playerSetGapless = (enabled: boolean) => invoke<void>("player_set_gapless", { enabled });
export const playerPreloadNext = (path: string | null, rgDb: number | null) =>
  invoke<void>("player_preload_next", { path, rgDb });
export const playerSetRg = (rgDb: number | null) => invoke<void>("player_set_rg", { rgDb });
export const playerSetVisualizer = (enabled: boolean) => invoke<void>("player_set_visualizer", { enabled });

// ---- Playlist commands -----------------------------------------------------

export const playlistsGetAll = () => invoke<PlaylistRow[]>("playlists_get_all");
export const playlistsCreate = (id: string, name: string, createdAt: number, smartRules?: string) =>
  invoke<void>("playlists_create", { id, name, createdAt, smartRules: smartRules ?? null });
export const playlistsSetRules = (id: string, smartRules: string) =>
  invoke<void>("playlists_set_rules", { id, smartRules });
export const playlistsRename = (id: string, name: string) => invoke<void>("playlists_rename", { id, name });
export const playlistsDelete = (id: string) => invoke<void>("playlists_delete", { id });
export const playlistsSetTracks = (id: string, trackIds: string[]) =>
  invoke<void>("playlists_set_tracks", { id, trackIds });

// ---- Settings commands -----------------------------------------------------

export const settingsGet = () => invoke<string | null>("settings_get");
export const settingsSet = (json: string) => invoke<void>("settings_set", { json });

// ---- Vault audio on this device (two-tier cache) ------------------------------

export interface CacheEntryRow {
  /** Cache key: `vault:<contentHash>`. */
  fileId: string;
  path: string;
  size: number;
  pinned: boolean;
  lastAccess: number;
  createdAt: number;
}

export interface CacheStats {
  autoBytes: number;
  pinnedBytes: number;
  maxBytes: number;
}

export interface VaultDownloadProgress {
  fileId: string;
  downloaded: number;
  total: number;
}

export interface VaultDownloadDone {
  fileId: string;
  path: string;
  pinned: boolean;
}

export interface VaultDownloadError {
  fileId: string;
  message: string;
}

export const vaultDownloadsList = () => invoke<CacheEntryRow[]>("vault_downloads_list");
export const vaultDownloadRemove = (fileId: string) => invoke<void>("vault_download_remove", { fileId });
export const vaultCacheStats = () => invoke<CacheStats>("vault_cache_stats");
export const vaultCacheSetMax = (maxBytes: number) => invoke<CacheStats>("vault_cache_set_max", { maxBytes });
export const vaultCacheClear = () => invoke<CacheStats>("vault_cache_clear");
export const vaultDownloadCancel = (fileIds: string[]) => invoke<void>("vault_download_cancel", { fileIds });

export interface DownloadsDir {
  path: string;
  defaultPath: string;
}

export interface DownloadsMoveProgress {
  /** Downloads handled so far (moved, failed or already gone). */
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
}

export interface DownloadsMoveReport {
  moved: number;
  /** Downloads left in the old folder (in use, disk full); they still play from there. */
  failed: number;
}

export const vaultDownloadsDir = () => invoke<DownloadsDir>("vault_downloads_dir");
/** Moves pinned downloads to `dir` and keeps new ones there; `defaultPath` goes back. */
export const vaultDownloadsMove = (dir: string) => invoke<DownloadsMoveReport>("vault_downloads_move", { dir });
export const onVaultDownloadsMoveProgress = (cb: (e: DownloadsMoveProgress) => void): Promise<UnlistenFn> =>
  listen<DownloadsMoveProgress>("vault://downloads-move-progress", (e) => cb(e.payload));

// ---- Sync engine storage commands -------------------------------------------

export interface SyncOutboxRow {
  id: string;
  createdAt: string;
  /** Full SyncOp envelope JSON. */
  payload: string;
  attempts: number;
}

export interface SyncShadowRow {
  id: string;
  payload: string;
}

export const syncOutboxAll = () => invoke<SyncOutboxRow[]>("sync_outbox_all");
export const syncOutboxPut = (id: string, createdAt: string, payload: string) =>
  invoke<void>("sync_outbox_put", { id, createdAt, payload });
export const syncOutboxDelete = (ids: string[]) => invoke<void>("sync_outbox_delete", { ids });
export const syncOutboxBump = (ids: string[]) => invoke<void>("sync_outbox_bump", { ids });
export const syncCursorGet = (name: string) => invoke<string | null>("sync_cursor_get", { name });
export const syncCursorSet = (name: string, value: string) =>
  invoke<void>("sync_cursor_set", { name, value });
export const syncShadowGet = (entity: string, id: string) =>
  invoke<string | null>("sync_shadow_get", { entity, id });
export const syncShadowPut = (entity: string, id: string, payload: string) =>
  invoke<void>("sync_shadow_put", { entity, id, payload });
export const syncShadowDelete = (entity: string, id: string) =>
  invoke<void>("sync_shadow_delete", { entity, id });
export const syncShadowAll = (entity: string) => invoke<SyncShadowRow[]>("sync_shadow_all", { entity });
export const syncClearAll = () => invoke<void>("sync_clear_all");

// ---- Local play-event log (Phase 7 statistics) --------------------------------

export interface PlayEventLocalRow {
  /** Client-generated UUID, shared with the playEvent.add sync op. */
  id: string;
  /** Library track id (`vault:<contentHash>`). */
  trackId: string;
  /** Session start, epoch ms. */
  playedAt: number;
  /** Seconds actually listened. */
  durationPlayed: number;
  completed: boolean;
}

export const playEventAdd = (e: PlayEventLocalRow) =>
  invoke<void>("play_event_add", {
    id: e.id,
    trackId: e.trackId,
    playedAt: e.playedAt,
    durationPlayed: e.durationPlayed,
    completed: e.completed,
  });
export const playEventsAll = () => invoke<PlayEventLocalRow[]>("play_events_all");

// ---- SMTC commands ---------------------------------------------------------

export const smtcUpdate = (
  title: string,
  artist: string,
  album: string,
  artworkPath: string | null,
  duration: number,
) => invoke<void>("smtc_update", { title, artist, album, artworkPath, duration });
export const smtcPlayback = (playing: boolean, position: number) =>
  invoke<void>("smtc_playback", { playing, position });

// ---- Events ----------------------------------------------------------------

export const onPosition = (cb: (e: PositionEvent) => void): Promise<UnlistenFn> =>
  listen<PositionEvent>("player://position", (e) => cb(e.payload));
export const onPlayerState = (cb: (e: StateEvent) => void): Promise<UnlistenFn> =>
  listen<StateEvent>("player://state", (e) => cb(e.payload));
export const onEnded = (cb: () => void): Promise<UnlistenFn> =>
  listen<void>("player://ended", () => cb());
export const onAdvanced = (cb: (e: AdvancedEvent) => void): Promise<UnlistenFn> =>
  listen<AdvancedEvent>("player://advanced", (e) => cb(e.payload));
export const onDevice = (cb: (e: DeviceEvent) => void): Promise<UnlistenFn> =>
  listen<DeviceEvent>("player://device", (e) => cb(e.payload));
export const onSpectrum = (cb: (e: SpectrumEvent) => void): Promise<UnlistenFn> =>
  listen<SpectrumEvent>("player://spectrum", (e) => cb(e.payload));
export const onPlayerError = (cb: (e: PlayerErrorEvent) => void): Promise<UnlistenFn> =>
  listen<PlayerErrorEvent>("player://error", (e) => cb(e.payload));
export const onSmtcControl = (cb: (e: SmtcControlEvent) => void): Promise<UnlistenFn> =>
  listen<SmtcControlEvent>("smtc://control", (e) => cb(e.payload));
export const onVaultDownloadProgress = (cb: (e: VaultDownloadProgress) => void): Promise<UnlistenFn> =>
  listen<VaultDownloadProgress>("vault://download-progress", (e) => cb(e.payload));
export const onVaultDownloadDone = (cb: (e: VaultDownloadDone) => void): Promise<UnlistenFn> =>
  listen<VaultDownloadDone>("vault://download-done", (e) => cb(e.payload));
export const onVaultDownloadError = (cb: (e: VaultDownloadError) => void): Promise<UnlistenFn> =>
  listen<VaultDownloadError>("vault://download-error", (e) => cb(e.payload));

// ---- Vault (R2) transfers -------------------------------------------------------

/** A cover staged for upload: square JPEG + thumb, named by the full image's SHA-256. */
export interface PreparedCoverDto {
  sha256: string;
  fullPath: string;
  thumbPath: string;
  fullSize: number;
  thumbSize: number;
}

/** What Rust learned from a picked audio file (tags/technical keyed by Supabase column). */
export interface PreparedFileDto {
  path: string;
  fileName: string;
  fileSize: number;
  contentHash: string;
  ext: string;
  technical: {
    duration: number;
    codec: string | null;
    sample_rate: number | null;
    bit_depth: number | null;
    channels: number | null;
    replaygain_track_db: number | null;
    replaygain_album_db: number | null;
  };
  tags: Record<string, string | number>;
  lrc: string | null;
  cover: PreparedCoverDto | null;
}

export interface PrepareResultDto {
  path: string;
  file: PreparedFileDto | null;
  error: string | null;
}

export interface VaultUploadProgress {
  uploadId: string;
  sent: number;
  total: number;
}

export const vaultPrepareFiles = (paths: string[]) => invoke<PrepareResultDto[]>("vault_prepare_files", { paths });
export const vaultPrepareCover = (path: string) => invoke<PreparedCoverDto>("vault_prepare_cover", { path });
/** `expectedBlake3` (audio): the upload fails, and nothing is stored, if the file no longer has this hash. */
export const vaultPutFile = (url: string, path: string, uploadId: string, contentType: string, expectedBlake3?: string) =>
  invoke<void>("vault_put_file", { url, path, uploadId, contentType, expectedBlake3: expectedBlake3 ?? null });
export const vaultCached = (contentHash: string) => invoke<string | null>("vault_cached", { contentHash });
/** After an upload's commit: copies the file into the cache (`pin`: downloads); false when it moved or changed. */
export const vaultAdoptUpload = (path: string, contentHash: string, ext: string, pin: boolean) =>
  invoke<boolean>("vault_adopt_upload", { path, contentHash, ext, pin });
export const vaultDownload = (contentHash: string, ext: string, url: string, pin: boolean) =>
  invoke<string>("vault_download", { contentHash, ext, url, pin });
/** Drops this device's copies of tracks deleted from the vault. */
export const vaultForgetDeleted = (contentHashes: string[]) =>
  invoke<number>("vault_forget_deleted", { contentHashes });
export const vaultFetchArt = (url: string, fileName: string) => invoke<string>("vault_fetch_art", { url, fileName });
export const vaultAdoptArt = (sha256: string, fullPath: string, thumbPath: string) =>
  invoke<string>("vault_adopt_art", { sha256, fullPath, thumbPath });
export const onVaultUploadProgress = (cb: (e: VaultUploadProgress) => void): Promise<UnlistenFn> =>
  listen<VaultUploadProgress>("vault://upload-progress", (e) => cb(e.payload));
