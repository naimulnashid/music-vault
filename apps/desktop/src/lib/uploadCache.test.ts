import { describe, expect, it } from "vitest";
import { uploadCacheCopy } from "./uploadCache";

const source = { path: "C:/Music/Song.FLAC", contentHash: "a".repeat(64) };

describe("uploadCacheCopy", () => {
  it("copies a new upload under the extension the vault stored", () => {
    const outcome = { status: "uploaded", trackId: "t1", storageKey: `users/u/audio/${"a".repeat(64)}.flac` } as const;
    expect(uploadCacheCopy(outcome, source)).toEqual({ path: source.path, contentHash: source.contentHash, ext: "flac" });
  });

  it("copies a file linked to a known song too", () => {
    const outcome = { status: "linked", trackId: "t1", storageKey: "users/u/audio/x.mp3" } as const;
    expect(uploadCacheCopy(outcome, source)?.ext).toBe("mp3");
  });

  it("copies nothing when the vault already had the file", () => {
    expect(uploadCacheCopy({ status: "already-in-vault", trackId: "t1" }, source)).toBeNull();
  });
});
