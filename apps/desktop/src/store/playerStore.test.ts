import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../types";

const pause = vi.fn();
const seek = vi.fn();
vi.mock("../lib/player", () => ({ player: { pause, seek } }));
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

describe("restoreQueue", () => {
  const withPath = (id: string, path: string) => ({ id, path }) as Track;

  beforeEach(() => seek.mockClear());

  it("handing off to the song already loaded keeps its file and moves the engine", () => {
    usePlayerStore.getState().restoreTrack(withPath("a", "C:/cache/a.flac"), 21);
    usePlayerStore.getState().restoreQueue([withPath("x", ""), withPath("a", ""), withPath("b", "")], 1, 16.5);
    const state = usePlayerStore.getState();
    expect(state.currentTrack).toMatchObject({ id: "a", path: "C:/cache/a.flac" });
    expect(state.currentTime).toBe(16.5);
    expect(state.restoredQueue).toBe(state.queue);
    expect(seek).toHaveBeenCalledWith(16.5);
  });

  it("a different song is left for the engine to load", () => {
    usePlayerStore.getState().restoreTrack(withPath("a", "C:/cache/a.flac"), 21);
    usePlayerStore.getState().restoreQueue([withPath("b", "")], 0, 5);
    expect(usePlayerStore.getState().currentTrack).toMatchObject({ id: "b", path: "" });
    expect(seek).not.toHaveBeenCalled();
  });
});
