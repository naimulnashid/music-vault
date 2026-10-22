import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

/**
 * A text input with a suggestion list.
 *
 * - `show="all"`: opening the list (focus, click or the arrow) shows every
 *   option, whatever is typed; typing only moves the highlight to the first
 *   match. Used for short closed-ish lists (language, country), where a wrong
 *   value must not hide the right one.
 * - `show="matches"`: the list opens while typing and holds only the options
 *   containing the text. Used for long lists (artists, albums).
 *
 * `multi` treats the value as comma-separated names: suggestions match and
 * replace only the name after the last comma.
 */
export function Combobox({
  value,
  onChange,
  options,
  show,
  multi = false,
  placeholder,
  className = "",
  inputClassName = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  show: "all" | "matches";
  multi?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const head = multi ? value.slice(0, value.lastIndexOf(",") + 1) : "";
  const query = (multi ? value.slice(head.length) : value).trim().toLowerCase();

  const shown = useMemo(() => {
    if (show === "all") return options;
    if (!query) return [];
    return options.filter((o) => o.toLowerCase().includes(query)).slice(0, 50);
  }, [options, show, query]);

  useEffect(() => {
    if (!open) return;
    if (!query) {
      setActive(-1);
      return;
    }
    const lower = shown.map((o) => o.toLowerCase());
    const starts = lower.findIndex((o) => o.startsWith(query));
    setActive(starts >= 0 ? starts : lower.findIndex((o) => o.includes(query)));
  }, [open, query, shown]);

  useEffect(() => {
    if (active < 0) return;
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // The list is portalled and fixed, so dialogs that clip or transform don't cut it off.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => input.current && setRect(input.current.getBoundingClientRect());
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const pick = (option: string) => {
    onChange(multi ? `${head}${head ? " " : ""}${option}` : option);
    setOpen(false);
  };

  const visible = open && shown.length > 0 && rect !== null;
  const below = rect ? window.innerHeight - rect.bottom : 0;
  const maxHeight = Math.min(256, Math.max(below, rect?.top ?? 0) - 12);
  const flip = rect !== null && below < 160 && rect.top > below;

  return (
    <div className={`relative ${className}`}>
      <input
        ref={input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => show === "all" && setOpen(true)}
        onClick={() => show === "all" && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return setOpen(true);
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (shown.length === 0 ? -1 : (i + step + shown.length) % shown.length));
          } else if (e.key === "Enter" && visible && active >= 0) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape" && visible) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={visible}
        aria-autocomplete="list"
        autoComplete="off"
        className={`${inputClassName} ${show === "all" ? "pr-8" : ""}`}
      />
      {show === "all" && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show all"
          onMouseDown={(e) => {
            e.preventDefault();
            input.current?.focus();
            setOpen((o) => !o);
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-fg"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
      {visible &&
        createPortal(
          <div
            ref={list}
            role="listbox"
            style={{
              position: "fixed",
              left: rect.left,
              width: Math.max(rect.width, 160),
              maxHeight,
              ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
            }}
            className="z-[100] overflow-y-auto rounded-xl border border-line bg-surface shadow-xl py-1"
          >
            {shown.map((option, i) => (
              <div
                key={option}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(i)}
                className={`px-3 py-1.5 text-sm cursor-pointer truncate ${
                  i === active ? "bg-surface-2 text-fg" : "text-fg/90"
                }`}
              >
                {option}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
