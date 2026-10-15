import { useEffect } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";

export function useNotifications() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);

  useEffect(() => {
    if (!notificationsEnabled || !currentTrack) return;

    let cancelled = false;
    void (async () => {
      // Only surface a notification while the window is in the background —
      // a focused window already shows the now-playing bar.
      const [granted, focused] = await Promise.all([
        isPermissionGranted(),
        getCurrentWindow().isFocused(),
      ]);
      if (cancelled || !granted || focused) return;

      sendNotification({
        title: currentTrack.title,
        body: `${currentTrack.artist} · ${currentTrack.album}`,
        silent: true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [currentTrack, notificationsEnabled]);
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  const result = await requestPermission();
  return result === "granted";
}
