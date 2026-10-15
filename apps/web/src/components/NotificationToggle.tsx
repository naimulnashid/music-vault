import { useSettingsStore } from "../store/settingsStore";
import { requestNotificationPermission } from "../hooks/useNotifications";
import { Toggle } from "./ui/Toggle";

export function NotificationToggle() {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);

  const supported = typeof Notification !== "undefined";

  const handleToggle = async () => {
    if (!supported) return;
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    const granted = await requestNotificationPermission();
    setNotificationsEnabled(granted);
  };

  if (!supported) {
    return <p className="px-4 pb-2 text-xs text-subtle">This browser doesn’t support notifications.</p>;
  }

  return (
    <div className="px-4 pb-1">
      <Toggle
        checked={!!notificationsEnabled}
        onChange={() => void handleToggle()}
        label="Song change notifications"
        hint="A browser notice when a new song starts"
      />
    </div>
  );
}
