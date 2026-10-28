import type { SyncOpPayload, SyncStorage } from "./sync";
import { artistPhotoKey } from "./artistPhotos";

/**
 * Covers picked for playlists and smart groups
 * (supabase/migrations/0009_collection_covers.sql) are settings rows like
 * artist photos: scope "collection_cover", key = a collection key (below),
 * value = the cover key of the uploaded picture, or null for the default
 * cover again.
 */
export const COLLECTION_COVER_SCOPE = "collection_cover";

/** What a cover belongs to: a user playlist, a built-in smart playlist, or one group of a grouped one. */
export type CollectionKind = "playlist" | "smart" | "genre" | "year" | "language" | "country" | "vocals";

/** "playlist:<uuid>", "smart:favorites", "country:Bangladesh". */
export function collectionKey(kind: CollectionKind, id: string): string {
  return `${kind}:${id}`;
}

/** The `setting.set` op that sets (or with null, resets) a collection's cover. */
export function collectionCoverOp(collection: string, artworkKey: string | null, editedAt: string): SyncOpPayload {
  return { kind: "setting.set", scope: COLLECTION_COVER_SCOPE, key: collection, value: artworkKey, editedAt };
}

/** Collection key → cover key: the synced rows, then the queued edits (oldest first) on top. */
export function collectionCoversFrom(
  rows: readonly { scope: string; key: string; value: unknown }[],
  pending: readonly SyncOpPayload[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (collection: string, value: unknown) => {
    const key = artistPhotoKey(value);
    if (key) out[collection] = key;
    else delete out[collection];
  };
  for (const row of rows) if (row.scope === COLLECTION_COVER_SCOPE) put(row.key, row.value);
  for (const op of pending) if (op.kind === "setting.set" && op.scope === COLLECTION_COVER_SCOPE) put(op.key, op.value);
  return out;
}

/** collectionCoversFrom over what a device's sync storage holds. */
export async function loadCollectionCovers(storage: SyncStorage): Promise<Record<string, string>> {
  const rows = (await storage.shadowAll("settings")).map(({ payload }) => JSON.parse(payload) as { scope: string; key: string; value: unknown });
  const pending = (await storage.outboxAll()).map(({ op }) => op.payload);
  return collectionCoversFrom(rows, pending);
}
