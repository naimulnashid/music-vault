import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-[0_6px_20px_-8px_var(--color-accent)]",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "text-danger hover:bg-danger/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-sm gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

/** Pill button: the one shape for every text action in the app. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      className={`inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap select-none transition-[background-color,color,transform,opacity] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tooltip + accessible name. */
  label: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** Accent-coloured (toggle is on). */
  active?: boolean;
}

const ICON_SIZES = {
  xs: "w-7 h-7",
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
};

/** Round icon-only button with a soft hover disc. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "sm", active = false, className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      {...rest}
      className={`relative inline-flex items-center justify-center rounded-full shrink-0 transition-[background-color,color,transform] duration-150 active:scale-90 disabled:opacity-35 disabled:active:scale-100 hover:bg-surface-2 ${
        active ? "text-accent" : "text-muted hover:text-fg"
      } ${ICON_SIZES[size]} ${className}`}
    >
      {children}
      {active && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />}
    </button>
  );
});
