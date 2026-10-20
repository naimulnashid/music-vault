import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { onPlayerError } from "../lib/ipc";
import { onAppError } from "../lib/errorBus";

interface ToastState {
  message: string;
  detail?: string;
}

/** Transient bottom toast for engine errors (unreadable/missing files, device
 * failures) and app errors such as a song that couldn't be fetched. Engine
 * errors also land in the log file; this is the visible surface. */
export function ErrorToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let timer: number | undefined;
    const show = (next: ToastState) => {
      setToast(next);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 5000);
    };
    void onPlayerError(({ message, path }) => {
      show({ message, detail: path?.split(/[/\\]/).pop() });
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    // Errors from the app itself (a song that couldn't be fetched), not the engine.
    const offApp = onAppError((message) => show({ message }));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten?.();
      offApp();
    };
  }, []);

  return (
    <AnimatePresence>
      {toast && (
    <motion.div
      initial={{ opacity: 0, y: 16, x: "-50%" }}
      animate={{ opacity: 1, y: 0, x: "-50%" }}
      exit={{ opacity: 0, y: 8, x: "-50%" }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="fixed bottom-28 left-1/2 z-[80]"
    >
      <div className="flex items-center gap-3 max-w-md bg-surface-3 border border-line rounded-2xl shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)] pl-4 pr-2 py-3 text-sm">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-medium">{toast.message}</p>
          {toast.detail && <p className="truncate text-xs text-muted">{toast.detail}</p>}
        </div>
        <button
          onClick={() => setToast(null)}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-2"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
      )}
    </AnimatePresence>
  );
}
