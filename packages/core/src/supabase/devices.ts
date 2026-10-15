import type { MusicVaultClient } from "./client";
import type { DevicePlatform, DeviceRow } from "./database.types";

export interface DeviceInfo {
  name: string;
  platform: DevicePlatform;
}

/**
 * Registers this installation as a device (or refreshes last_seen_at if the
 * client already stored a device id). Returns the device row; callers persist
 * `id` locally and pass it back on the next launch.
 */
export async function registerDevice(
  client: MusicVaultClient,
  userId: string,
  info: DeviceInfo,
  existingDeviceId?: string,
): Promise<DeviceRow> {
  if (existingDeviceId) {
    const { data, error } = await client
      .from("devices")
      .update({ last_seen_at: new Date().toISOString(), name: info.name })
      .eq("id", existingDeviceId)
      .select()
      .single();
    if (!error && data) return data;
    // fall through: stored id no longer exists (row deleted) — re-register
  }
  const { data, error } = await client
    .from("devices")
    .insert({ user_id: userId, name: info.name, platform: info.platform })
    .select()
    .single();
  if (error) throw error;
  return data;
}
