import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import { useLibraryStore } from "../store/libraryStore";
import { seekAudio } from "./useAudioEngine";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useKeyboardShortcuts() {
  const lastVolume = useRef(0.8);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const player = usePlayerStore.getState();
      const settings = useSettingsStore.getState();

      switch (e.key) {
        case " ":
          e.preventDefault();
          player.togglePlay();
          break;
        case "ArrowRight":
          if (e.shiftKey) {
            player.next();
          } else {
            seekAudio(Math.min(player.currentTime + 5, player.duration || 0));
          }
          break;
        case "ArrowLeft":
          if (e.shiftKey) {
            player.prev();
          } else {
            seekAudio(Math.max(player.currentTime - 5, 0));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          settings.setVolume(Math.min(settings.volume + 0.05, 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          settings.setVolume(Math.max(settings.volume - 0.05, 0));
          break;
        case "m":
        case "M":
          if (settings.volume > 0) {
            lastVolume.current = settings.volume;
            settings.setVolume(0);
          } else {
            settings.setVolume(lastVolume.current || 0.8);
          }
          break;
        case "s":
        case "S":
          settings.setShuffle(!settings.shuffle);
          break;
        case "r":
        case "R": {
          const modes = ["off", "all", "one"] as const;
          const idx = modes.indexOf(settings.repeat);
          settings.setRepeat(modes[(idx + 1) % modes.length]);
          break;
        }
        case "f":
        case "F":
          if (player.currentTrack) {
            void useLibraryStore.getState().toggleFavorite(player.currentTrack.id);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
