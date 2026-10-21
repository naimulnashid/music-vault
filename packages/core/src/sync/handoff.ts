import type { QueueChange } from "./types";

/** What this device has at the moment the startup handoff is decided. */
export interface LocalQueueState {
  /** Nothing is loaded. */
  empty: boolean;
  /** Only what the startup restore put there, untouched since. */
  restoredOnly: boolean;
  /** When this device last played (ms since epoch); null if unknown. */
  lastPlayedAt: number | null;
}

/**
 * Newest wins at startup: whether a queue left on another device replaces what this
 * device restored. Its own queue (an echo) never does, an empty device takes any other
 * one, and a restored song gives way only to a queue written after this device last
 * played. Anything the user has touched since startup stays. Android mirrors this in
 * QueueHandoff.useRemote.
 */
export function handoffWins(remote: QueueChange, ownDeviceId: string | null, local: LocalQueueState): boolean {
  if (remote.tracks.length === 0) return false;
  if (remote.deviceId !== null && remote.deviceId === ownDeviceId) return false;
  if (local.empty) return true;
  if (!local.restoredOnly || local.lastPlayedAt === null) return false;
  const remoteAt = Date.parse(remote.editedAt);
  return Number.isFinite(remoteAt) && remoteAt > local.lastPlayedAt;
}
