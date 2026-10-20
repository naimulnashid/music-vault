import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../types";

const pause = vi.fn();
vi.mock("../lib/audioEngine", () => ({ audioEngine: { pause } }));
vi.mock("../lib/lastPlayback", () => ({ clearLastPlayback: vi.fn() }));
vi.mock("./settingsStore", () => ({ useSettingsStore: { getState: () => ({}) } }));

const { usePlayerStore } = await import("./playerStore");

const track = (id: string) => ({ id }) as Track;

describe("removeFromQueue", () => {
  beforeEach(() => {
    pause.mockClear();
    usePlayerStore.setState({ queue: [track("a")], currentIndex: 0, currentTrack: track("a"), isPlaying: true });
  });

  it("stops playback when the last song is removed", () => {
    usePlayerStore.getState().removeFromQueue(0);
    expect(pause).toHaveBeenCalled();
    expect(usePlayerStore.getState()).toMatchObject({ queue: [], currentTrack: null, isPlaying: false });
  });

  it("keeps playing when other songs remain", () => {
    usePlayerStore.setState({ queue: [track("a"), track("b")] });
    usePlayerStore.getState().removeFromQueue(1);
    expect(pause).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });
});
