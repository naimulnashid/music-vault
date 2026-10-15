import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import { useArtworkUrl } from "../lib/artwork";

export function useNotifications() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const artUrl = useArtworkUrl(currentTrack?.id);

  useEffect(() => {
    if (!notificationsEnabled || !currentTrack) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // Only surface a notification while the tab is in the background — a
    // foreground tab already shows the now-playing bar.
    if (!document.hidden) return;

    const notification = new Notification(currentTrack.title, {
      body: `${currentTrack.artist} · ${currentTrack.album}`,
      icon: artUrl ?? undefined,
      tag: "music-vault-now-playing",
      silent: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    return () => {
      notification.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack, notificationsEnabled]);
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}
