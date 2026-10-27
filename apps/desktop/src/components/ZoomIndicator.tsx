import { useEffect, useState } from "react";
import { Minus, Plus, ZoomIn } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useZoomStore, zoomPercent } from "../store/zoomStore";

/**
 * The zoom level, as a browser shows it: a small button in the top bar while
 * the window isn't at 100% (click to reset), and for a moment after each change.
 */
export function ZoomIndicator() {
  const zoom = useZoomStore((s) => s.zoom);
  const changedAt = useZoomStore((s) => s.changedAt);
  const zoomIn = useZoomStore((s) => s.zoomIn);
  const zoomOut = useZoomStore((s) => s.zoomOut);
  const reset = useZoomStore((s) => s.reset);
  const [recent, setRecent] = useState(false);

  useEffect(() => {
    if (!changedAt) return;
    setRecent(true);
    const timer = setTimeout(() => setRecent(false), 2500);
    return () => clearTimeout(timer);
  }, [changedAt]);

  return (
    <AnimatePresence>
      {(zoom !== 1 || recent) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.18 }}
          className="flex items-center h-9 rounded-full bg-surface-2 text-sm"
        >
          {recent && (
            <button onClick={zoomOut} aria-label="Zoom out" className="w-8 h-9 flex items-center justify-center text-muted hover:text-fg">
              <Minus className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={reset}
            title="Reset zoom to 100% (Ctrl+0)"
            className={`flex items-center gap-1.5 h-9 font-semibold tabular-nums hover:text-accent ${recent ? "px-1" : "px-3"}`}
          >
            {!recent && <ZoomIn className="w-4 h-4" />}
            {zoomPercent(zoom)}
          </button>
          {recent && (
            <button onClick={zoomIn} aria-label="Zoom in" className="w-8 h-9 flex items-center justify-center text-muted hover:text-fg">
              <Plus className="w-4 h-4" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
