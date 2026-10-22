import { describe, expect, it } from "vitest";
import { ARTIST_PHOTO_SCOPE, artistPhotoKey, artistPhotoOp, artistPhotosFrom } from "../src/artistPhotos";

const KEY_A = `users/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/art/${"a".repeat(64)}.jpg`;
const KEY_B = KEY_A.replace("a".repeat(64), "b".repeat(64));

describe("artist photos", () => {
  it("accepts only full cover keys", () => {
    expect(artistPhotoKey(KEY_A)).toBe(KEY_A);
    expect(artistPhotoKey(null)).toBeNull();
    expect(artistPhotoKey(KEY_A.replace(".jpg", ".thumb.jpg"))).toBeNull();
    expect(artistPhotoKey(42)).toBeNull();
  });

  it("reads synced rows, ignores other scopes, and lays queued edits on top", () => {
    const rows = [
      { scope: ARTIST_PHOTO_SCOPE, key: "Mira Sol", value: KEY_A },
      { scope: ARTIST_PHOTO_SCOPE, key: "Gone", value: KEY_A },
      { scope: "global", key: "theme", value: "dark" },
    ];
    const pending = [artistPhotoOp("Mira Sol", KEY_B, "2026-10-22T00:00:00Z"), artistPhotoOp("Gone", null, "2026-10-22T00:00:01Z")];
    expect(artistPhotosFrom(rows, pending)).toEqual({ "Mira Sol": KEY_B });
  });
});
