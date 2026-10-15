import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * One hover tooltip for every chart, styled like the seek bar's. It floats in
 * a portal at fixed position, so it is never clipped by a chart's scroller and
 * never widens it.
 *
 * `bind(text)` goes on the hover target. The tooltip points at the target's
 * `[data-tip-anchor]` child when it has one (a bar inside a full-height
 * column), else at the target itself.
 */
export function useChartTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);

  const bind = (text: ReactNode) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      const anchor = e.currentTarget.querySelector<HTMLElement>("[data-tip-anchor]") ?? e.currentTarget;
      const r = anchor.getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, text });
    },
    onMouseLeave: () => setTip(null),
  });

  const node = tip
    ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full px-2 py-1 rounded-md bg-surface-3 text-fg text-[11px] font-semibold tabular-nums shadow-lg whitespace-nowrap"
          style={{ left: Math.min(Math.max(tip.x, 64), window.innerWidth - 64), top: tip.y - 12 }}
        >
          {tip.text}
        </div>,
        document.body,
      )
    : null;

  return { bind, node };
}
