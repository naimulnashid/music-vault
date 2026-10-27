import { useEffect } from "react";
import { useZoomStore } from "../store/zoomStore";

/** Ctrl+plus / Ctrl+minus / Ctrl+0 and Ctrl+wheel, as in a browser. */
export function useZoom() {
  useEffect(() => {
    useZoomStore.getState().init();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const zoom = useZoomStore.getState();
      if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") zoom.zoomIn();
      else if (e.key === "-" || e.code === "NumpadSubtract") zoom.zoomOut();
      else if (e.key === "0" || e.code === "Numpad0") zoom.reset();
      else return;
      e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) useZoomStore.getState().zoomIn();
      else if (e.deltaY > 0) useZoomStore.getState().zoomOut();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);
}
