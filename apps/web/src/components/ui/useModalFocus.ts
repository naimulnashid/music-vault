import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Recent elements focused outside any dialog, newest last. A field with
// autoFocus inside the dialog takes focus before the hook below runs, and a
// dialog opened from a menu item outlives that menu, so focus goes back to the
// newest of these that is still on the page (the button that opened the menu).
const recentOutside: HTMLElement[] = [];
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    if (!(e.target instanceof HTMLElement) || e.target.closest('[role="dialog"]')) return;
    recentOutside.push(e.target);
    if (recentOutside.length > 8) recentOutside.shift();
  });
}

function returnTarget(): HTMLElement | null {
  for (let i = recentOutside.length - 1; i >= 0; i--) {
    const el = recentOutside[i];
    // A menu item is never the place to land: its menu is closing (or gone).
    if (el.isConnected && el !== document.body && !el.closest('[role="menu"]')) return el;
  }
  return null;
}

// Open dialogs, oldest first. Only the newest answers Escape and Tab, so
// closing a dialog opened from another one leaves the first one open.
const openStack: object[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
}

/**
 * Modal keyboard behaviour for a dialog panel: focus moves in when it opens,
 * Tab and Shift+Tab stay inside, Escape calls `onEscape` (when given), the rest
 * of the page is inert to keyboard and screen readers, and focus returns to
 * what opened it on close. The panel must be rendered into document.body
 * (a portal), so everything else on the page can be made inert.
 */
export function useModalFocus(panel: RefObject<HTMLElement | null>, open: boolean, onEscape?: () => void): void {
  // Parents pass a fresh callback every render; reading it through a ref keeps
  // the effect from re-running (and re-focusing) on each keystroke.
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const root = panel.current;
    if (!root) return;

    // Everything outside the dialog's own top-level node goes inert.
    const host = [...document.body.children].find((el) => el.contains(root));
    const inerted = [...document.body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== host && !el.inert,
    );
    inerted.forEach((el) => (el.inert = true));

    // Start on the first field when there is one (a name to type), else the
    // first control; the header's Close button comes first in the DOM but is
    // rarely what the user opened the dialog for.
    const items = focusables(root);
    const start = items.find((el) => el.matches("input, textarea, select")) ?? items[0];
    (start ?? root).focus({ preventScroll: true });

    const token = {};
    openStack.push(token);

    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== token) return;
      if (e.key === "Escape" && escape.current) {
        escape.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || !root.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !root.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      openStack.splice(openStack.indexOf(token), 1);
      inerted.forEach((el) => (el.inert = false));
      // Back to whatever opened the dialog (or the newest control still on the page).
      returnTarget()?.focus({ preventScroll: true });
    };
  }, [panel, open]);
}
