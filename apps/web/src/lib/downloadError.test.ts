import { describe, expect, it } from "vitest";
import { downloadFailureMessage } from "./downloadError";

describe("downloadFailureMessage", () => {
  it("says nothing when every download worked", () => {
    expect(downloadFailureMessage([])).toBeNull();
  });

  it("names the song when one download failed", () => {
    expect(downloadFailureMessage([{ title: "Tidal", err: new Error("download rejected (403)") }], true)).toBe(
      "Tidal: download rejected (403)",
    );
  });

  it("sums up a run of failures in one message", () => {
    const failures = [
      { title: "Tidal", err: new TypeError("Failed to fetch") },
      { title: "Coastline", err: new TypeError("Failed to fetch") },
    ];
    expect(downloadFailureMessage(failures, true)).toBe("Couldn't download 2 songs: Can't download while offline");
  });
});
