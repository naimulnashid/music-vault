import { motion } from "motion/react";
import { useId } from "react";

/** Single-choice pill row (sort orders, ranges, filters). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs font-semibold text-subtle mr-1">{label}</span>}
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={`relative h-8 px-3.5 rounded-lg text-sm font-semibold transition-colors ${
              active ? "text-bg" : "bg-surface-2 text-fg hover:bg-surface-3"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`chip-${id}`}
                className="absolute inset-0 rounded-lg bg-fg"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
