import { describe, expect, it } from "vitest";
import { downloadFailureMessage, moveFailureMessage } from "./downloadError";

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

describe("moveFailureMessage", () => {
  it("says nothing when every download moved", () => {
    expect(moveFailureMessage(0)).toBeNull();
  });

  it("says the ones left behind still play and how to retry", () => {
    expect(moveFailureMessage(1)).toBe(
      "1 download couldn't move and still plays from the old folder (in use, or the new folder is full). Choose the folder again to retry.",
    );
    expect(moveFailureMessage(3)).toMatch(/^3 downloads couldn't move and still play from/);
  });
});
