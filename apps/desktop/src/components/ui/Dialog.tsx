import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Tailwind width class for the panel. */
  widthClass?: string;
  children: ReactNode;
  /** Escape / backdrop click close it (off while a save is running). */
  dismissible?: boolean;
}

/** Modal sheet: blurred backdrop, panel rises in with a spring. */
export function Dialog({ open, onClose, title, widthClass = "max-w-md", children, dismissible = true }: DialogProps) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismissible, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog"
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-scrim backdrop-blur-sm"
            onClick={dismissible ? onClose : undefined}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className={`relative w-full ${widthClass} max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-surface border border-line shadow-[0_24px_80px_-16px_rgb(0_0_0/0.6)] overflow-hidden`}
          >
            {title !== undefined && (
              <div className="flex items-center gap-3 px-5 pt-5 pb-3 shrink-0">
                <h2 className="flex-1 min-w-0 text-lg font-bold truncate">{title}</h2>
                {dismissible && (
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="w-8 h-8 -mr-1.5 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-2 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
