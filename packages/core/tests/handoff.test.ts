import { describe, expect, it } from "vitest";
import { handoffWins, type QueueChange } from "../src/sync";

const remote = (s: Partial<QueueChange> = {}): QueueChange => ({
  tracks: [{ remoteId: "t1", contentHash: "h1" }],
  currentIndex: 0,
  positionSeconds: 12,
  shuffle: false,
  repeat: "off",
  deviceId: "phone",
  editedAt: "2026-10-21T10:00:00Z",
  ...s,
});
const at10 = Date.parse("2026-10-21T10:00:00Z");
const restored = (lastPlayedAt: number | null) => ({ empty: false, restoredOnly: true, lastPlayedAt });

describe("handoffWins", () => {
  it("a queue written after this device last played replaces its restored song", () => {
    expect(handoffWins(remote(), "desktop", restored(at10 - 60_000))).toBe(true);
    expect(handoffWins(remote(), "desktop", restored(at10 + 60_000))).toBe(false);
  });

  it("an empty device takes any other device's queue", () => {
    expect(handoffWins(remote(), "desktop", { empty: true, restoredOnly: false, lastPlayedAt: null })).toBe(true);
  });

  it("its own echo, an empty server queue, a touched queue and an unknown play time keep the local one", () => {
    expect(handoffWins(remote({ deviceId: "desktop" }), "desktop", restored(0))).toBe(false);
    expect(handoffWins(remote({ tracks: [] }), "desktop", { empty: true, restoredOnly: false, lastPlayedAt: null })).toBe(false);
    expect(handoffWins(remote(), "desktop", { empty: false, restoredOnly: false, lastPlayedAt: 0 })).toBe(false);
    expect(handoffWins(remote(), "desktop", restored(null))).toBe(false);
  });
});
