import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { onAppError } from "../lib/errorBus";

/** Bottom-center toast for app errors (playback, downloads, uploads). */
export function ErrorToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onAppError((msg) => {
      setMessage(msg);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 6000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 16, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, y: 8, x: "-50%" }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="fixed bottom-28 left-1/2 z-[80]"
        >
          <div className="flex items-center gap-3 max-w-md bg-surface-3 border border-line rounded-2xl shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)] pl-4 pr-2 py-3 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span className="min-w-0 font-medium">{message}</span>
            <button
              onClick={() => setMessage(null)}
              title="Dismiss"
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
