import { Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useSettingsStore } from "../store/settingsStore";
import { Toggle } from "./ui/Toggle";

type Mode = "light" | "dark" | "system";

const MODES: { key: Mode; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
];

/** Light / Dark / System segmented control plus the AMOLED switch. */
export function ThemeSwitcher() {
  const theme = useSettingsStore((s) => s.theme);
  const amoled = useSettingsStore((s) => s.amoled);
  const followSystemTheme = useSettingsStore((s) => s.followSystemTheme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setAmoled = useSettingsStore((s) => s.setAmoled);
  const setFollowSystemTheme = useSettingsStore((s) => s.setFollowSystemTheme);

  const mode: Mode = followSystemTheme ? "system" : theme === "light" ? "light" : "dark";
  const choose = (m: Mode) => {
    if (m === "system") {
      setFollowSystemTheme(true);
    } else {
      setFollowSystemTheme(false);
      setTheme(m);
    }
  };

  return (
    <div className="px-4 pb-2 space-y-2">
      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-2">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => choose(key)}
            className={`relative h-9 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
              mode === key ? "text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {mode === key && (
              <motion.span
                layoutId="theme-mode"
                className="absolute inset-0 rounded-lg bg-surface shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className="relative w-3.5 h-3.5" />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      <Toggle checked={!!amoled} onChange={setAmoled} label="Pure black (AMOLED)" hint="Dark theme only" />
    </div>
  );
}
