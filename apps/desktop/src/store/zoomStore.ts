import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Window zoom, driven by the app rather than WebView2's own Ctrl+plus/minus
 * (tauri.conf.json turns those off) so the level can be shown and kept
 * across restarts. The steps are a browser's.
 */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const KEY = "mv.zoom";

function loadZoom(): number {
  try {
    const saved = Number(localStorage.getItem(KEY));
    return ZOOM_STEPS.includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

interface ZoomState {
  zoom: number;
  /** Bumped on every change, so the indicator can show itself again. */
  changedAt: number;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Applies the saved level at startup. */
  init: () => void;
}

function apply(zoom: number) {
  getCurrentWebview()
    .setZoom(zoom)
    .catch((err) => console.error("[zoom] setting the zoom failed:", err));
}

export const useZoomStore = create<ZoomState>((set, get) => ({
  zoom: loadZoom(),
  changedAt: 0,
  setZoom: (zoom) => {
    apply(zoom);
    try {
      localStorage.setItem(KEY, String(zoom));
    } catch {
      // Not kept for next time; the level still applies now.
    }
    set({ zoom, changedAt: Date.now() });
  },
  zoomIn: () => {
    const next = ZOOM_STEPS.find((z) => z > get().zoom + 0.001);
    if (next) get().setZoom(next);
  },
  zoomOut: () => {
    const next = [...ZOOM_STEPS].reverse().find((z) => z < get().zoom - 0.001);
    if (next) get().setZoom(next);
  },
  reset: () => get().setZoom(1),
  init: () => {
    if (get().zoom !== 1) apply(get().zoom);
  },
}));

export const zoomPercent = (zoom: number) => `${Math.round(zoom * 100)}%`;
