import { motion } from "motion/react";

/** Labelled on/off switch. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 py-1.5 text-left"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-subtle">{hint}</span>}
      </span>
      <span
        className={`relative w-10 h-6 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-accent" : "bg-surface-3"}`}
      >
        <motion.span
          className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow"
          animate={{ x: checked ? 16 : 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 35 }}
        />
      </span>
    </button>
  );
}
