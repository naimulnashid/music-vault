import { describe, expect, it } from "vitest";
import { isOfflineError, playbackErrorMessage } from "./playbackError";

describe("playbackErrorMessage", () => {
  it("says a song isn't available offline when the device is offline", () => {
    expect(playbackErrorMessage("Darkside", new Error("anything"), false)).toBe("Darkside: Not available offline");
  });

  it("treats a failed fetch as offline even when the browser thinks it's online", () => {
    expect(playbackErrorMessage("Darkside", new TypeError("Failed to fetch"), true)).toBe("Darkside: Not available offline");
    expect(isOfflineError("download failed: error sending request", true)).toBe(true);
  });

  it("keeps the real reason for other failures", () => {
    expect(playbackErrorMessage("Darkside", new Error("This track has no audio in your vault."), true)).toBe(
      "Darkside: This track has no audio in your vault.",
    );
  });

  it("falls back to a plain message when there is no reason", () => {
    expect(playbackErrorMessage("Darkside", undefined, true)).toBe("Darkside: Couldn't play this song");
  });
});
