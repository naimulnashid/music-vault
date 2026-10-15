import { parseBlob } from "music-metadata";
import { createBLAKE3 } from "hash-wasm";
import {
  audioExtOf,
  COVER_JPEG_QUALITY,
  COVER_MAX_PX,
  COVER_THUMB_PX,
  coverEdge,
  parseLrc,
  releaseDateFromTag,
  squareCrop,
  type LyricLine,
  type PreparedCover,
  type TrackEditPatch,
  type UploadSource,
} from "@musicvault/core";

/**
 * Browser-side upload preparation (the web counterpart of desktop's Rust
 * vault::prepare): the BLAKE3 identity, the
 * file's tags and technical facts via music-metadata, and covers turned into
 * the vault's square JPEG + thumbnail with a canvas. Nothing leaves the
 * browser here.
 */

export interface WebSource extends UploadSource {
  file: File;
}

/** The bytes behind a PreparedCover on the web, plus a preview URL. */
export interface WebCoverHandle {
  full: Blob;
  thumb: Blob;
  previewUrl: string;
}

const READ_CHUNK = 4 * 1024 * 1024;

/** BLAKE3 of a file, read in chunks. */
export async function hashFile(file: Blob): Promise<string> {
  const blake = await createBLAKE3();
  blake.init();
  for (let offset = 0; offset < file.size; offset += READ_CHUNK) {
    blake.update(new Uint8Array(await file.slice(offset, offset + READ_CHUNK).arrayBuffer()));
  }
  return blake.digest("hex");
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encodeSquare(bitmap: ImageBitmap, crop: { sx: number; sy: number; size: number }, edge: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(edge, edge);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't available in this browser");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, edge, edge);
  return canvas.convertToBlob({ type: "image/jpeg", quality: COVER_JPEG_QUALITY });
}

/** Square-crops and resizes an image into the vault's cover format. */
export async function prepareCover(image: Blob): Promise<PreparedCover> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new Error("That image couldn't be read — try a JPEG or PNG.");
  }
  try {
    const crop = squareCrop(bitmap.width, bitmap.height);
    if (crop.size === 0) throw new Error("That image has no pixels.");
    const full = await encodeSquare(bitmap, crop, coverEdge(crop.size, COVER_MAX_PX));
    const thumb = await encodeSquare(bitmap, crop, coverEdge(crop.size, COVER_THUMB_PX));
    const handle: WebCoverHandle = { full, thumb, previewUrl: URL.createObjectURL(thumb) };
    return { sha256: await sha256Hex(full), fullSize: full.size, thumbSize: thumb.size, handle };
  } finally {
    bitmap.close();
  }
}

export function coverPreviewUrl(cover: PreparedCover | null | undefined): string | undefined {
  return cover ? (cover.handle as WebCoverHandle).previewUrl : undefined;
}

const MS_TIMESTAMPS = 2; // music-metadata TimestampFormat.milliseconds

/**
 * Everything the upload form needs from one picked file. `lrcText` is the
 * content of a same-named .lrc file picked alongside, if any.
 */
export async function prepareFile(file: File, lrcText?: string): Promise<WebSource> {
  const ext = audioExtOf(file.name);
  if (!ext) throw new Error(`${file.name} isn't a supported audio format`);
  if (file.size === 0) throw new Error(`${file.name} is empty`);

  const [blake3, meta] = await Promise.all([
    hashFile(file),
    parseBlob(file, { duration: true, skipCovers: false }).catch(() => null),
  ]);
  const common = meta?.common;
  const format = meta?.format;

  const tags: TrackEditPatch = {};
  const text = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  if (text(common?.title)) tags.title = text(common?.title);
  if (text(common?.artist)) tags.artist = text(common?.artist);
  if (text(common?.album)) tags.album = text(common?.album);
  if (text(common?.genre?.[0])) tags.genre = text(common?.genre?.[0]);
  if (text(common?.language)) tags.language = text(common?.language);
  const released = releaseDateFromTag(common?.releasedate ?? common?.date ?? common?.year);
  if (released) tags.release_date = released;

  const lyric = common?.lyrics?.[0];
  if (text(lyric?.text)) tags.lyrics_text = text(lyric?.text);
  let synced: LyricLine[] = [];
  if (lrcText) synced = parseLrc(lrcText);
  else if (lyric?.syncText?.length && lyric.timeStampFormat === MS_TIMESTAMPS) {
    synced = lyric.syncText
      .filter((l) => l.timestamp !== undefined)
      .map((l) => ({ time: (l.timestamp ?? 0) / 1000, text: l.text }));
  }
  if (synced.length > 0) tags.lyrics_synced = synced;

  let embeddedCover: PreparedCover | null = null;
  const picture = common?.picture?.[0];
  if (picture) {
    embeddedCover = await prepareCover(new Blob([picture.data as BlobPart], { type: picture.format })).catch(() => null);
  }

  return {
    file,
    fileName: file.name,
    fileSize: file.size,
    contentHash: blake3,
    ext,
    technical: {
      duration: format?.duration ?? 0,
      codec: format?.codec ?? format?.container ?? null,
      sample_rate: format?.sampleRate ?? null,
      bit_depth: format?.bitsPerSample ?? null,
      channels: format?.numberOfChannels ?? null,
      replaygain_track_db: common?.replaygain_track_gain?.dB ?? null,
      replaygain_album_db: common?.replaygain_album_gain?.dB ?? null,
    },
    tags,
    embeddedCover,
  };
}

/** Recursively collects files from a drag-and-drop (folders included). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}
