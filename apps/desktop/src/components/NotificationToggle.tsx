import { useSettingsStore } from "../store/settingsStore";
import { requestNotificationPermission } from "../hooks/useNotifications";
import { Toggle } from "./ui/Toggle";

export function NotificationToggle() {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);

  // Native notifications via the Tauri plugin are always available on Windows.
  const handleToggle = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    const granted = await requestNotificationPermission();
    setNotificationsEnabled(granted);
  };

  return (
    <div className="px-4 pb-1">
      <Toggle
        checked={!!notificationsEnabled}
        onChange={() => void handleToggle()}
        label="Song change notifications"
        hint="A desktop notice when a new song starts"
      />
    </div>
  );
}
