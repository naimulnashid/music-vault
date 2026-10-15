// Object key layout for the vault bucket (docs/drive-to-r2-migration.md §2.1):
//   users/<user-id>/audio/<blake3-hex>.<ext>
//   users/<user-id>/art/<sha256-hex>.jpg          full cover
//   users/<user-id>/art/<sha256-hex>.thumb.jpg    256 px thumbnail
// Keys are built only from validated parts, so they never need URL-encoding.

/** Extensions the players can decode (Symphonia + ape/wv on desktop, Media3, browsers). */
export const AUDIO_EXTS: ReadonlySet<string> = new Set([
  "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "mp4", "aac", "alac", "aiff", "aif", "ape", "wv",
]);

export const MAX_AUDIO_BYTES = 2 * 1024 ** 3;
export const MAX_ART_BYTES = 5 * 1024 ** 2;

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AUDIO_KEY = /^users\/([0-9a-f-]{36})\/audio\/[0-9a-f]{64}\.([a-z0-9]{2,5})$/;
const ART_KEY = /^users\/([0-9a-f-]{36})\/art\/([0-9a-f]{64})(\.thumb)?\.jpg$/;

export type ArtVariant = "full" | "thumb";

export function isHex64(v: unknown): v is string {
  return typeof v === "string" && HEX64.test(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function isAudioExt(v: unknown): v is string {
  return typeof v === "string" && AUDIO_EXTS.has(v);
}

export function audioKey(userId: string, contentHash: string, ext: string): string {
  return `users/${userId}/audio/${contentHash}.${ext}`;
}

export function artKey(userId: string, sha256: string, variant: ArtVariant): string {
  return `users/${userId}/art/${sha256}${variant === "thumb" ? ".thumb" : ""}.jpg`;
}

/** The thumbnail key that belongs to a full-size cover key. */
export function thumbKeyOf(fullArtKey: string): string {
  return fullArtKey.replace(/\.jpg$/, ".thumb.jpg");
}

export type ParsedKey =
  | { kind: "audio"; userId: string }
  | { kind: "art"; userId: string; fullKey: string };

/**
 * Classifies a key the client asks to read. Thumbnails resolve to their full
 * cover key, which is what `tracks.artwork_key` stores.
 */
export function parseKey(key: unknown): ParsedKey | null {
  if (typeof key !== "string") return null;
  const audio = AUDIO_KEY.exec(key);
  if (audio) return AUDIO_EXTS.has(audio[2]) ? { kind: "audio", userId: audio[1] } : null;
  const art = ART_KEY.exec(key);
  if (art) return { kind: "art", userId: art[1], fullKey: `users/${art[1]}/art/${art[2]}.jpg` };
  return null;
}
