import { useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";

/**
 * Applies the theme settings to <html>: follow-OS theme (live via
 * matchMedia) and AMOLED pure-black (only meaningful when the effective
 * theme is dark). The accent is fixed (Vibrant Violet, in index.css); the
 * synced `accent` setting is no longer applied.
 */
export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const amoled = useSettingsStore((s) => s.amoled);
  const followSystemTheme = useSettingsStore((s) => s.followSystemTheme);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const effective = followSystemTheme ? (media.matches ? "dark" : "light") : theme;
      root.setAttribute("data-theme", effective);
      if (effective === "dark" && amoled) {
        root.setAttribute("data-amoled", "true");
      } else {
        root.removeAttribute("data-amoled");
      }
      // Older builds wrote a per-user accent onto <html>; clear it.
      root.removeAttribute("data-accent");
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-fg");
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, amoled, followSystemTheme]);
}
