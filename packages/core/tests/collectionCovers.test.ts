import { describe, expect, it } from "vitest";
import { ARTIST_PHOTO_SCOPE } from "../src/artistPhotos";
import { COLLECTION_COVER_SCOPE, collectionCoverOp, collectionCoversFrom, collectionKey } from "../src/collectionCovers";

const KEY_A = `users/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/art/${"a".repeat(64)}.jpg`;
const KEY_B = KEY_A.replace("a".repeat(64), "b".repeat(64));

describe("collection covers", () => {
  it("keys a collection by kind and id", () => {
    expect(collectionKey("country", "Bangladesh")).toBe("country:Bangladesh");
    expect(collectionKey("smart", "favorites")).toBe("smart:favorites");
  });

  it("reads its own scope only and lays queued edits on top", () => {
    const rows = [
      { scope: COLLECTION_COVER_SCOPE, key: "country:Bangladesh", value: KEY_A },
      { scope: COLLECTION_COVER_SCOPE, key: "playlist:p1", value: KEY_A },
      { scope: ARTIST_PHOTO_SCOPE, key: "country:India", value: KEY_A },
      { scope: COLLECTION_COVER_SCOPE, key: "genre:Rock", value: "not a key" },
    ];
    const pending = [
      collectionCoverOp("country:Bangladesh", KEY_B, "2026-10-27T00:00:00Z"),
      collectionCoverOp("playlist:p1", null, "2026-10-27T00:00:01Z"),
    ];
    expect(collectionCoversFrom(rows, pending)).toEqual({ "country:Bangladesh": KEY_B });
  });
});
