import { useEffect, useState } from "react";
import { thumbKeyOf } from "@musicvault/core";
import { getArtwork, putArtwork } from "./db";
import { signedUrls } from "./vault";

/**
 * Artwork on the web is extracted from downloaded audio files and stored in
 * IndexedDB (tracks that were never downloaded have none). Object URLs are
 * cached per track for the app's lifetime — cheap, and avoids revoke races
 * between the many components that render the same art.
 *
 * List rows and grids ask for the thumb variant: a ~256px JPEG generated
 * lazily from the full art and stored under a `thumb:`-prefixed key in the
 * same object store (the store is keyed by plain strings, so no schema
 * migration is needed). Full art stays for the now-playing views.
 */

const THUMB_SIZE = 256;
const THUMB_PREFIX = "thumb:";

const urlCache = new Map<string, string | null>();
/** trackId → online cover key, kept current by the library store. */
const artKeyById = new Map<string, string>();
const VAULT_PREFIX = "vault:";

/**
 * Called whenever the library list changes: tracks whose online cover key
 * changed get their cached URLs dropped so open views reload them.
 */
export function registerArtworkKeys(tracks: { id: string; artworkKey?: string }[]): void {
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    seen.add(t.id);
    const prev = artKeyById.get(t.id);
    if (t.artworkKey === prev) continue;
    if (t.artworkKey) artKeyById.set(t.id, t.artworkKey);
    else artKeyById.delete(t.id);
    changed.push(t.id);
  }
  for (const id of artKeyById.keys()) if (!seen.has(id)) artKeyById.delete(id);
  for (const id of changed) invalidateArtwork(id);
}

/** An online cover (or its thumb), from IndexedDB or fetched from R2 once. */
async function loadVaultBlob(artworkKey: string, thumb: boolean): Promise<Blob | undefined> {
  const objectKey = thumb ? thumbKeyOf(artworkKey) : artworkKey;
  const stored = await getArtwork(VAULT_PREFIX + objectKey);
  if (stored) return stored;
  const url = await signedUrls()?.getOne(objectKey);
  if (!url) return undefined;
  const res = await fetch(url);
  if (!res.ok) return thumb ? loadVaultBlob(artworkKey, false) : undefined;
  const blob = await res.blob();
  await putArtwork(VAULT_PREFIX + objectKey, blob).catch(() => {});
  return blob;
}
const pending = new Map<string, Promise<string | null>>();
const bumpListeners = new Set<(trackId: string) => void>();

async function makeThumb(full: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(full);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return full; // already small — store as-is
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  } catch {
    return null; // unsupported format — caller falls back to full art
  }
}

async function loadBlob(trackId: string, thumb: boolean): Promise<Blob | undefined> {
  // An online cover wins over art extracted from a downloaded file.
  const artworkKey = artKeyById.get(trackId);
  if (artworkKey) {
    const blob = await loadVaultBlob(artworkKey, thumb).catch(() => undefined);
    if (blob) return blob;
  }
  if (!thumb) return getArtwork(trackId);
  const existing = await getArtwork(THUMB_PREFIX + trackId);
  if (existing) return existing;
  const full = await getArtwork(trackId);
  if (!full) return undefined;
  const scaled = await makeThumb(full);
  if (!scaled) return full;
  await putArtwork(THUMB_PREFIX + trackId, scaled).catch(() => {});
  return scaled;
}

export async function getArtworkUrl(trackId: string, thumb = false): Promise<string | null> {
  const key = thumb ? THUMB_PREFIX + trackId : trackId;
  if (urlCache.has(key)) return urlCache.get(key)!;
  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const blob = await loadBlob(trackId, thumb).catch(() => undefined);
      const url = blob ? URL.createObjectURL(blob) : null;
      urlCache.set(key, url);
      pending.delete(key);
      return url;
    })();
    pending.set(key, p);
  }
  return p;
}

/** Stores a cover this browser just uploaded, so it shows without downloading it back. */
export async function adoptVaultCover(artworkKey: string, full: Blob, thumb: Blob): Promise<void> {
  await putArtwork(VAULT_PREFIX + artworkKey, full).catch(() => {});
  await putArtwork(VAULT_PREFIX + thumbKeyOf(artworkKey), thumb).catch(() => {});
  for (const [trackId, key] of artKeyById) if (key === artworkKey) invalidateArtwork(trackId);
}

/** Called after a download extracts new artwork so open views refresh. */
export function invalidateArtwork(trackId: string): void {
  for (const key of [trackId, THUMB_PREFIX + trackId]) {
    const url = urlCache.get(key);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(key);
  }
  for (const listener of bumpListeners) listener(trackId);
}

export function useArtworkUrl(trackId: string | undefined, thumb = false): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    trackId ? (urlCache.get(thumb ? THUMB_PREFIX + trackId : trackId) ?? null) : null,
  );

  useEffect(() => {
    if (!trackId) {
      setUrl(null);
      return;
    }
    let alive = true;
    void getArtworkUrl(trackId, thumb).then((u) => {
      if (alive) setUrl(u);
    });
    const onBump = (id: string) => {
      if (id === trackId && alive) void getArtworkUrl(trackId, thumb).then((u) => alive && setUrl(u));
    };
    bumpListeners.add(onBump);
    return () => {
      alive = false;
      bumpListeners.delete(onBump);
    };
  }, [trackId, thumb]);

  return url;
}
