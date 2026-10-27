import type { MusicVaultClient } from "./client";
import type { DevicePlatform, DeviceRow } from "./database.types";

export interface DeviceInfo {
  name: string;
  platform: DevicePlatform;
}

/**
 * Registers this installation as a device (or refreshes last_seen_at if the
 * client already stored a device id, or the account already has a device of
 * this name and platform). Returns the device row; callers persist `id`
 * locally and pass it back on the next launch.
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
  // A reinstall or cleared storage loses the stored id. The same machine comes
  // back under the same name, so it takes its old row instead of adding one
  // that splits its play history in two.
  const { data: same } = await client
    .from("devices")
    .select()
    .eq("user_id", userId)
    .eq("name", info.name)
    .eq("platform", info.platform)
    .order("last_seen_at", { ascending: false })
    .limit(1);
  if (same && same.length > 0) {
    const { data } = await client
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", same[0].id)
      .select()
      .single();
    return data ?? same[0];
  }
  const { data, error } = await client
    .from("devices")
    .insert({ user_id: userId, name: info.name, platform: info.platform })
    .select()
    .single();
  if (error) throw error;
  return data;
}
