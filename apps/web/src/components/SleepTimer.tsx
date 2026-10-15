import { useEffect, useRef, useState } from "react";
import { Moon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSleepStore } from "../store/sleepStore";
import { IconButton } from "./ui/Button";

const OPTIONS = [15, 30, 45, 60];

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function SleepTimer() {
  const endsAt = useSleepStore((s) => s.endsAt);
  const remainingMs = useSleepStore((s) => s.remainingMs);
  const start = useSleepStore((s) => s.start);
  const cancel = useSleepStore((s) => s.cancel);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = endsAt !== null;

  return (
    <div className="relative" ref={ref}>
      <IconButton label={active ? `Sleep timer: ${formatRemaining(remainingMs)} left` : "Sleep timer"} active={active} onClick={() => setOpen((o) => !o)}>
        <Moon className="w-[18px] h-[18px]" />
      </IconButton>
      {active && (
        <span className="absolute left-1/2 -translate-x-1/2 -top-3 px-1 rounded bg-accent text-accent-fg text-[9px] font-bold tabular-nums whitespace-nowrap pointer-events-none">
          {formatRemaining(remainingMs)}
        </span>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "bottom right" }}
            className="absolute right-0 bottom-11 z-40 w-48 bg-surface border border-line rounded-xl shadow-[0_16px_48px_-12px_rgb(0_0_0/0.55)] py-1.5"
          >
            <div className="px-3 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-subtle">Stop playing in</div>
            {OPTIONS.map((minutes) => (
              <button
                key={minutes}
                onClick={() => {
                  start(minutes);
                  setOpen(false);
                }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors"
              >
                {minutes} minutes
              </button>
            ))}
            {active && (
              <button
                onClick={() => {
                  cancel();
                  setOpen(false);
                }}
                className="block w-full text-left px-3 py-2 text-sm text-danger hover:bg-danger/10 border-t border-line mt-1"
              >
                Turn off timer
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
