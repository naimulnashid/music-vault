import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface SliderProps {
  value: number;
  max: number;
  /** Fires continuously while dragging when `commitOnRelease` is off. */
  onChange: (value: number) => void;
  /** Seek bars: only report the value when the drag ends (no audio stutter). */
  commitOnRelease?: boolean;
  /** Text for the hover bubble (e.g. a timestamp); no bubble when absent. */
  formatTooltip?: (value: number) => string;
  /** Second, lighter fill (buffered / downloaded share, 0–1). */
  buffered?: number;
  disabled?: boolean;
  label: string;
  /** Track thickness in px when idle; grows on hover. */
  thickness?: number;
  className?: string;
  step?: number;
}

/**
 * Pointer-driven slider shared by the seek bar and volume: a thin track that
 * thickens on hover, an accent fill and a knob that appears on hover/drag.
 */
export function Slider({
  value,
  max,
  onChange,
  commitOnRelease = false,
  formatTooltip,
  buffered,
  disabled = false,
  label,
  thickness = 4,
  className = "",
  step,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  const safeMax = max > 0 ? max : 1;
  const shown = dragValue ?? value;
  const ratio = Math.min(1, Math.max(0, shown / safeMax));

  const ratioAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = ratioAt(e.clientX) * safeMax;
    setDragValue(v);
    if (!commitOnRelease) onChange(v);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = ratioAt(e.clientX);
    setHoverRatio(r);
    if (dragValue === null) return;
    const v = r * safeMax;
    setDragValue(v);
    if (!commitOnRelease) onChange(v);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (dragValue === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const v = ratioAt(e.clientX) * safeMax;
    setDragValue(null);
    onChange(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const inc = step ?? safeMax / 20;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(safeMax, value + inc));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, value - inc));
    } else if (e.key === "Home") {
      onChange(0);
    } else if (e.key === "End") {
      onChange(safeMax);
    }
  };

  const dragging = dragValue !== null;
  const tooltipRatio = dragging ? ratio : hoverRatio;

  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(shown)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragValue(null)}
      onPointerLeave={() => setHoverRatio(null)}
      onKeyDown={onKeyDown}
      data-dragging={dragging || undefined}
      className={`group/slider relative flex items-center touch-none outline-none ${
        disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"
      } ${className}`}
      style={{ minHeight: 16 }}
    >
      <div
        ref={trackRef}
        className="relative w-full rounded-full bg-fg/15 transition-[height] duration-150 group-hover/slider:h-[var(--th-hover)] group-data-[dragging]/slider:h-[var(--th-hover)]"
        style={
          {
            height: thickness,
            "--th-hover": `${thickness + 2}px`,
          } as React.CSSProperties
        }
      >
        {buffered !== undefined && buffered > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-fg/20"
            style={{ width: `${Math.min(1, buffered) * 100}%` }}
          />
        )}
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
        <div
          className="absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_6px_rgb(0_0_0/0.4)] scale-0 transition-transform duration-150 group-hover/slider:scale-100 group-focus-visible/slider:scale-100 group-data-[dragging]/slider:scale-110"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
      {formatTooltip && tooltipRatio !== null && (
        <div
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 px-2 py-1 rounded-md bg-surface-3 text-fg text-[11px] font-semibold tabular-nums shadow-lg whitespace-nowrap"
          style={{ left: `${tooltipRatio * 100}%` }}
        >
          {formatTooltip(tooltipRatio * safeMax)}
        </div>
      )}
    </div>
  );
}
