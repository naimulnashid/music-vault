import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCheckpoint, countsAsPlay, isCompleted, newPlaySession, saveCheckpoint, takeCheckpoint } from "./playSession";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("play sessions", () => {
  it("gives every session its own event id", () => {
    const a = newPlaySession({ id: "t1", duration: 200 }, null, null);
    const b = newPlaySession({ id: "t1", duration: 200 }, null, null);
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("counts a session from one second and completes it at 90 percent", () => {
    const s = newPlaySession({ id: "t1", duration: 100 }, null, null);
    expect(countsAsPlay(s)).toBe(false);
    s.seconds = 1;
    expect(countsAsPlay(s)).toBe(true);
    expect(isCompleted(s)).toBe(false);
    s.seconds = 90;
    expect(isCompleted(s)).toBe(true);
  });

  it("hands back a checkpointed session once, with the same event id", () => {
    const s = newPlaySession({ id: "t1", duration: 100 }, null, null);
    s.seconds = 42;
    saveCheckpoint(s);
    expect(takeCheckpoint()).toEqual(s);
    expect(takeCheckpoint()).toBeNull();
  });

  it("forgets the checkpoint when the session is recorded normally", () => {
    saveCheckpoint(newPlaySession({ id: "t1", duration: 100 }, null, null));
    clearCheckpoint();
    expect(takeCheckpoint()).toBeNull();
  });

  it("ignores a malformed checkpoint", () => {
    localStorage.setItem("mv.playSession", "{not json");
    expect(takeCheckpoint()).toBeNull();
  });
});
