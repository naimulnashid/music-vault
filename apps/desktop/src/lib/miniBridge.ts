import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Cross-window contract between the main window (which owns the stores and
 * the queue) and the mini player window (a dumb remote-control view).
 */

/** Snapshot the main window broadcasts on "mini://state". */
export interface MiniState {
  hasTrack: boolean;
  title: string | null;
  artist: string | null;
  artworkPath: string | null;
  playing: boolean;
  position: number;
  duration: number;
  favorite: boolean;
}

/** Command the mini window emits on "mini://cmd". */
export interface MiniCmd {
  action: "toggle" | "next" | "prev" | "seek" | "favorite";
  position?: number;
}

export const miniToggle = () => invoke<void>("mini_toggle");

export const emitMiniState = (state: MiniState) => emit("mini://state", state);
export const emitMiniReady = () => emit("mini://ready");
export const emitMiniCmd = (cmd: MiniCmd) => emit("mini://cmd", cmd);

export const onMiniState = (cb: (s: MiniState) => void): Promise<UnlistenFn> =>
  listen<MiniState>("mini://state", (e) => cb(e.payload));
export const onMiniReady = (cb: () => void): Promise<UnlistenFn> =>
  listen<void>("mini://ready", () => cb());
export const onMiniCmd = (cb: (c: MiniCmd) => void): Promise<UnlistenFn> =>
  listen<MiniCmd>("mini://cmd", (e) => cb(e.payload));
