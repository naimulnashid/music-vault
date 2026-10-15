import type { Database, TrackRow } from "./supabase/database.types";
import { diffTrackFields, normalizeTrackPatch, TrackEditError, type TrackEditPatch } from "./trackFields";
import type { VaultApi } from "./vault";

/**
 * Upload preparation and orchestration shared by every client
 * (docs/drive-to-r2-migration.md §2.4). Platforms supply what only they can:
 * hashing and tag reading of the picked file, cover resizing, and the actual
 * byte transfer to a pre-signed URL. Everything else — what the form starts
 * with, batch defaults, validation, and the resolve → row → PUT → commit
 * sequence — lives here so all three apps behave the same.
 */

/** Audio extensions the vault accepts. Must equal AUDIO_EXTS in supabase/functions/vault/keys.ts. */
export const AUDIO_EXTS: readonly string[] = [
  "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "mp4", "aac", "alac", "aiff", "aif", "ape", "wv",
];

/** Cover processing rules: square centre crop, JPEG, a full size and a thumbnail. */
export const COVER_MAX_PX = 1200;
export const COVER_THUMB_PX = 256;
export const COVER_JPEG_QUALITY = 0.88;
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** The vault extension for a file name, or null when the format isn't supported. */
export function audioExtOf(fileName: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName);
  const ext = m?.[1].toLowerCase() ?? null;
  return ext && AUDIO_EXTS.includes(ext) ? ext : null;
}

/** The centred square to crop from a w×h image. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/** Output edge length for a square of `size` px, never upscaling. */
export function coverEdge(size: number, max: number): number {
  return Math.max(1, Math.min(size, max));
}

/** Properties read from the audio itself: shown in the editor, never editable. */
export interface TechnicalProps {
  duration: number;
  codec: string | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  replaygain_track_db: number | null;
  replaygain_album_db: number | null;
}

/** What a platform learned from a picked file before the form opens. */
export interface UploadSource {
  fileName: string;
  fileSize: number;
  /** BLAKE3 of the file bytes (lower-case hex) — the track's identity. */
  contentHash: string;
  ext: string;
  technical: TechnicalProps;
  /** The file's own tags; they only pre-fill the form. */
  tags: TrackEditPatch;
  /** The embedded cover, already cropped and resized by the platform. */
  embeddedCover?: PreparedCover | null;
}

/** A cover ready to upload. `handle` is whatever the platform needs to send the bytes. */
export interface PreparedCover {
  /** SHA-256 of the full-size JPEG — names the object, dedupes shared album art. */
  sha256: string;
  fullSize: number;
  thumbSize: number;
  handle: unknown;
}

export interface UploadDraft {
  source: UploadSource;
  /** The form's current values (editable fields only). */
  fields: TrackEditPatch;
  /** The cover to upload with the track; null = none. */
  cover: PreparedCover | null;
}

const fileStem = (name: string) => name.replace(/\.[^.]+$/, "").trim() || name;

/** The form's starting point: the file's tags, with the file name as a fallback title. */
export function draftFromSource(source: UploadSource): UploadDraft {
  const tags = source.tags;
  const title = typeof tags.title === "string" && tags.title.trim() ? tags.title.trim() : fileStem(source.fileName);
  return {
    source,
    fields: { ...tags, title },
    cover: source.embeddedCover ?? null,
  };
}

/**
 * Batch editing: copies each field present in `shared` onto every draft
 * (e.g. album, artist, year, language for a whole album). A shared cover
 * replaces each draft's cover when given; `null` clears them.
 */
export function applyBatchFields(
  drafts: UploadDraft[],
  shared: TrackEditPatch,
  cover?: PreparedCover | null,
): UploadDraft[] {
  return drafts.map((d) => ({
    ...d,
    fields: { ...d.fields, ...shared },
    cover: cover === undefined ? d.cover : cover,
  }));
}

/** Human-readable problems that block uploading this draft (empty = ready). */
export function validateDraft(draft: UploadDraft): string[] {
  const problems: string[] = [];
  if (!AUDIO_EXTS.includes(draft.source.ext)) problems.push(`.${draft.source.ext} files aren't supported`);
  if (!/^[0-9a-f]{64}$/.test(draft.source.contentHash)) problems.push("the file hasn't been hashed");
  if (draft.cover && draft.cover.fullSize > MAX_COVER_BYTES) problems.push("the cover image is too large");
  try {
    normalizeTrackPatch(draft.fields as Record<string, unknown>);
  } catch (e) {
    problems.push(e instanceof TrackEditError ? e.message : String(e));
  }
  return problems;
}

export type NewTrackRow = Database["public"]["Tables"]["tracks"]["Insert"];

/** The row inserted for a song the vault has never seen. */
export function newTrackRow(userId: string, draft: UploadDraft, artworkKey: string | null): NewTrackRow {
  const fields = normalizeTrackPatch(draft.fields as Record<string, unknown>);
  const { source } = draft;
  return {
    user_id: userId,
    content_hash: source.contentHash,
    file_name: source.fileName,
    file_size: source.fileSize,
    ...source.technical,
    ...fields,
    title: fields.title ?? fileStem(source.fileName),
    artist: fields.artist ?? "",
    album: fields.album ?? "",
    artwork_key: artworkKey,
  } as NewTrackRow;
}

export type UploadStage = "resolving" | "cover" | "saving" | "uploading" | "committing" | "done";

export interface UploadDeps {
  userId: string;
  vault: VaultApi;
  getTrack(id: string): Promise<TrackRow | null>;
  /** Inserts a fresh row for a new song; returns its id. */
  insertTrack(row: NewTrackRow): Promise<string>;
  /** Records the file's technical facts on an existing row being linked. */
  updateTechnical(trackId: string, props: TechnicalProps & { file_size: number }): Promise<void>;
  /** Applies metadata changes to an existing row (normally: enqueue track.edit). */
  applyEdit(trackId: string, patch: TrackEditPatch): Promise<void>;
  /** Sends the audio bytes to a pre-signed PUT URL. */
  putAudio(url: string, draft: UploadDraft): Promise<void>;
  /** Sends a cover's full-size or thumbnail JPEG to a pre-signed PUT URL. */
  putCover(url: string, cover: PreparedCover, variant: "full" | "thumb"): Promise<void>;
  onStage?(stage: UploadStage): void;
}

export type UploadOutcome =
  /** A new track was created and its audio stored. */
  | { status: "uploaded"; trackId: string; storageKey: string }
  /** The file matched an existing track (history kept); its audio is now stored. */
  | { status: "linked"; trackId: string; storageKey: string }
  /** The exact file is already in the vault; nothing was uploaded. */
  | { status: "already-in-vault"; trackId: string };

/**
 * Uploads one confirmed draft: resolves the target row (keeping history for
 * known songs), uploads the cover, creates or updates the row, PUTs the
 * audio and commits it. Safe to retry after a failure at any step — the
 * row is found again by hash and the content-addressed objects overwrite.
 */
export async function uploadTrack(deps: UploadDeps, draft: UploadDraft): Promise<UploadOutcome> {
  const problems = validateDraft(draft);
  if (problems.length > 0) throw new Error(problems.join("; "));
  const { source } = draft;
  const fields = normalizeTrackPatch(draft.fields as Record<string, unknown>);

  deps.onStage?.("resolving");
  const targetId = await deps.vault.resolveUploadTarget(source.contentHash);
  const existing = targetId ? await deps.getTrack(targetId) : null;
  if (existing && existing.storage_key && !existing.deleted_at) {
    deps.onStage?.("done");
    return { status: "already-in-vault", trackId: existing.id };
  }

  let artworkKey: string | null = null;
  if (draft.cover) {
    deps.onStage?.("cover");
    const full = await deps.vault.signPutArt(draft.cover.sha256, "full", draft.cover.fullSize);
    await deps.putCover(full.url, draft.cover, "full");
    const thumb = await deps.vault.signPutArt(draft.cover.sha256, "thumb", draft.cover.thumbSize);
    await deps.putCover(thumb.url, draft.cover, "thumb");
    artworkKey = full.key;
  }

  deps.onStage?.("saving");
  let trackId: string;
  let patch: TrackEditPatch = {};
  if (existing) {
    trackId = existing.id;
    await deps.updateTechnical(trackId, { ...source.technical, file_size: source.fileSize });
    const wanted: TrackEditPatch = draft.cover ? { ...fields, artwork_key: artworkKey } : fields;
    patch = diffTrackFields(existing, wanted);
  } else {
    trackId = await deps.insertTrack(newTrackRow(deps.userId, draft, artworkKey));
  }

  deps.onStage?.("uploading");
  const put = await deps.vault.signPutAudio(trackId, source.ext);
  await deps.putAudio(put.url, draft);

  deps.onStage?.("committing");
  const committed = await deps.vault.commit(trackId, source.ext);
  // The edit goes out only now: a re-uploaded deleted track is a tombstone
  // until the commit revives it, and an edit flushed before would be dropped.
  if (Object.keys(patch).length > 0) await deps.applyEdit(trackId, patch);

  deps.onStage?.("done");
  return { status: existing ? "linked" : "uploaded", trackId, storageKey: committed.storageKey };
}
