import { useCallback, useEffect, useRef, useState } from "react";

/** Rendered beyond the viewport on each side, in rows. */
const OVERSCAN = 12;
/** Rows rendered on the very first pass, before the scroll parent is known. */
const FIRST_PASS_ROWS = 60;

export interface VirtualRows {
  /** Attach to the list wrapper element. */
  listRef: (el: HTMLElement | null) => void;
  /** Render only rows in [start, end). */
  start: number;
  end: number;
  /** Spacer heights standing in for the unrendered rows. */
  padTop: number;
  padBottom: number;
}

/**
 * Fixed-height windowed rendering for long lists (kept 1:1 between the
 * desktop and web apps, like TrackList itself).
 *
 * The list is not its own scroll container — views scroll a parent
 * (`overflow-y-auto`) that may hold headers and other content above the
 * list, so the window is computed from the list's offset inside the nearest
 * scrollable ancestor. Rows must be exactly `rowHeight` px tall.
 */
export function useVirtualRows(count: number, rowHeight: number): VirtualRows {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, FIRST_PASS_ROWS) });
  const listEl = useRef<HTMLElement | null>(null);
  const scrollEl = useRef<HTMLElement | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const countRef = useRef(count);
  countRef.current = count;

  const update = useCallback(() => {
    const list = listEl.current;
    const scroller = scrollEl.current;
    const total = countRef.current;
    if (!list) return;
    if (!scroller) {
      // No scrollable ancestor — window nothing, render the whole list.
      setRange((prev) => (prev.start === 0 && prev.end === total ? prev : { start: 0, end: total }));
      return;
    }
    const listTop =
      list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const viewTop = scroller.scrollTop - listTop;
    const start = Math.max(0, Math.floor(viewTop / rowHeight) - OVERSCAN);
    const end = Math.min(total, Math.ceil((viewTop + scroller.clientHeight) / rowHeight) + OVERSCAN);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [rowHeight]);

  const listRef = useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      listEl.current = el;
      if (!el) return;

      let parent: HTMLElement | null = el.parentElement;
      while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        parent = parent.parentElement;
      }
      scrollEl.current = parent;
      if (parent) {
        parent.addEventListener("scroll", update, { passive: true });
        const resize = new ResizeObserver(update);
        resize.observe(parent);
        cleanup.current = () => {
          parent.removeEventListener("scroll", update);
          resize.disconnect();
        };
      }
      update();
    },
    [update],
  );

  // Re-window when the list length changes (filtering, imports, deletions).
  useEffect(() => update(), [count, update]);
  useEffect(() => () => cleanup.current?.(), []);

  const end = Math.min(range.end, count);
  const start = Math.min(range.start, end);
  return {
    listRef,
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, count - end) * rowHeight,
  };
}
