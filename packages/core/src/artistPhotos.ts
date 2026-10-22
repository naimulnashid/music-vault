import type { SyncOpPayload, SyncStorage } from "./sync";

/**
 * Artist photos (supabase/migrations/0008_artist_photos.sql) are settings
 * rows: scope "artist_photo", key = the artist's name, value = the cover key
 * of the uploaded picture, or null once removed. They sync like any setting;
 * the server only accepts the owner's own full cover key.
 */
export const ARTIST_PHOTO_SCOPE = "artist_photo";

const COVER_KEY = /^users\/[0-9a-f-]{36}\/art\/[0-9a-f]{64}\.jpg$/;

/** The cover key a setting value holds, or null for a removed or malformed photo. */
export function artistPhotoKey(value: unknown): string | null {
  return typeof value === "string" && COVER_KEY.test(value) ? value : null;
}

/** The `setting.set` op that sets (or with null, removes) an artist's photo. */
export function artistPhotoOp(artist: string, artworkKey: string | null, editedAt: string): SyncOpPayload {
  return { kind: "setting.set", scope: ARTIST_PHOTO_SCOPE, key: artist, value: artworkKey, editedAt };
}

/**
 * Artist → cover key: the synced rows, then the queued edits (oldest first)
 * on top, so a photo picked offline shows before it is pushed.
 */
export function artistPhotosFrom(
  rows: readonly { scope: string; key: string; value: unknown }[],
  pending: readonly SyncOpPayload[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (artist: string, value: unknown) => {
    const key = artistPhotoKey(value);
    if (key) out[artist] = key;
    else delete out[artist];
  };
  for (const row of rows) if (row.scope === ARTIST_PHOTO_SCOPE) put(row.key, row.value);
  for (const op of pending) if (op.kind === "setting.set" && op.scope === ARTIST_PHOTO_SCOPE) put(op.key, op.value);
  return out;
}

/** artistPhotosFrom over what a device's sync storage holds. */
export async function loadArtistPhotos(storage: SyncStorage): Promise<Record<string, string>> {
  const rows = (await storage.shadowAll("settings")).map(({ payload }) => JSON.parse(payload) as { scope: string; key: string; value: unknown });
  const pending = (await storage.outboxAll()).map(({ op }) => op.payload);
  return artistPhotosFrom(rows, pending);
}
