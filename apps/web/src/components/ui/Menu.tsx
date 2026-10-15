import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Nested items open to the side on hover (e.g. "Add to playlist"). */
  submenu?: MenuItem[];
  /** Shown instead of a submenu when it's empty. */
  emptyText?: string;
}

export type MenuEntry = MenuItem | "divider";

export interface MenuAnchor {
  x: number;
  y: number;
}

/** Turns a trigger button into a menu anchor just below/left of it. */
export function anchorFromElement(el: HTMLElement): MenuAnchor {
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.bottom + 4 };
}

interface MenuProps {
  anchor: MenuAnchor | null;
  items: MenuEntry[];
  onClose: () => void;
  /** Optional header (e.g. the song the menu acts on). */
  header?: ReactNode;
}

/**
 * Floating menu used for every "⋮" button and right-click: portal-rendered,
 * clamped to the viewport, scale-in animation, Escape/outside-click closes.
 */
export function Menu({ anchor, items, onClose, header }: MenuProps) {
  return createPortal(
    <AnimatePresence>
      {anchor && <MenuPanel key="menu" anchor={anchor} items={items} onClose={onClose} header={header} />}
    </AnimatePresence>,
    document.body,
  );
}

function MenuPanel({ anchor, items, onClose, header }: MenuProps & { anchor: MenuAnchor }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer opening down-left of the anchor (it is usually a ⋮ at a row's
    // right edge); flip when it would leave the window.
    let left = anchor.x - width;
    let originX = "right";
    if (left < 8) {
      left = Math.min(anchor.x, vw - width - 8);
      originX = "left";
    }
    let top = anchor.y;
    let originY = "top";
    if (top + height > vh - 8) {
      top = Math.max(8, anchor.y - height - 8);
      originY = "bottom";
    }
    setPos({ left, top, origin: `${originY} ${originX}` });
  }, [anchor]);

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-mv-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Scrolling the page moves the anchor away; scrolling inside a long
    // submenu must not close it.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest("[data-mv-menu]"))) onClose();
    };
    // Next tick so the click that opened the menu doesn't close it.
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("contextmenu", onDown);
    });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("contextmenu", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", onScroll);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      data-mv-menu
      role="menu"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "fixed",
        left: pos?.left ?? anchor.x,
        top: pos?.top ?? anchor.y,
        transformOrigin: pos?.origin ?? "top right",
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-[100] min-w-56 max-w-72 py-1.5 rounded-xl bg-surface border border-line shadow-[0_16px_48px_-12px_rgb(0_0_0/0.55)]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {header && <div className="px-3 pt-1.5 pb-2 mb-1 border-b border-line">{header}</div>}
      <MenuList items={items} onClose={onClose} />
    </motion.div>
  );
}

function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <>
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={`d${i}`} className="my-1.5 h-px bg-line" />
        ) : (
          <MenuRow
            key={item.label}
            item={item}
            subOpen={openSub === i}
            onHover={() => setOpenSub(item.submenu ? i : null)}
            onClose={onClose}
          />
        ),
      )}
    </>
  );
}

function MenuRow({
  item,
  subOpen,
  onHover,
  onClose,
}: {
  item: MenuItem;
  subOpen: boolean;
  onHover: () => void;
  onClose: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"right" | "left">("right");

  useLayoutEffect(() => {
    if (!subOpen || !rowRef.current) return;
    const r = rowRef.current.getBoundingClientRect();
    setSide(r.right + 240 > window.innerWidth ? "left" : "right");
  }, [subOpen]);

  return (
    <div ref={rowRef} className="relative" onMouseEnter={onHover}>
      <button
        role="menuitem"
        disabled={item.disabled}
        onClick={() => {
          if (item.submenu) {
            onHover();
            return;
          }
          item.onSelect?.();
          onClose();
        }}
        className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors disabled:opacity-40 ${
          item.danger ? "text-danger hover:bg-danger/10" : "text-fg hover:bg-surface-2"
        } ${subOpen ? "bg-surface-2" : ""}`}
      >
        <span className="w-4 h-4 shrink-0 flex items-center justify-center text-muted [&>svg]:w-4 [&>svg]:h-4">
          {item.icon}
        </span>
        <span className="flex-1 truncate">{item.label}</span>
        {item.submenu && <ChevronRight className="w-4 h-4 text-muted" />}
      </button>
      <AnimatePresence>
        {item.submenu && subOpen && (
          <motion.div
            data-mv-menu
            initial={{ opacity: 0, x: side === "right" ? -6 : 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.14 }}
            className={`absolute top-[-6px] ${
              side === "right" ? "left-full ml-1" : "right-full mr-1"
            } min-w-52 max-w-64 max-h-80 overflow-y-auto py-1.5 rounded-xl bg-surface border border-line shadow-[0_16px_48px_-12px_rgb(0_0_0/0.55)]`}
          >
            {item.submenu.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">{item.emptyText ?? "Nothing here"}</p>
            ) : (
              <MenuList items={item.submenu} onClose={onClose} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
