import { SIGN_IN_AGAIN } from "./engine";
import type { SyncStatus } from "./types";

export interface SyncStatusText {
  /** One line: what sync is doing, or why it stopped. */
  label: string;
  /** One line each: what that means for the user's edits, and when sync last worked. Empty when the label says it all. */
  details: string[];
  /** The session can't be renewed: the fix is signing in, not waiting. */
  needsSignIn: boolean;
}

const orElse = (lines: string[], fallback: string) => (lines.length > 0 ? lines : [fallback]);
const changes = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

/** "Last synced 10:42" today, "Last synced 20 Oct" before; null if it never has. */
function lastSynced(at: string | null, now: Date): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const when =
    d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `Last synced ${when}`;
}

/**
 * The account menu's sync row. When sync is stuck, the detail lines answer what a
 * user needs to know: are my edits safe (kept on this device until they go up),
 * and how stale is this device. Android mirrors this in SyncStatusText.kt.
 */
export function describeSyncStatus(status: SyncStatus, now: Date = new Date()): SyncStatusText {
  const stuck = () =>
    [status.pendingOps > 0 ? `${changes(status.pendingOps)} kept on this device` : null, lastSynced(status.lastSyncAt, now)].filter(
      (line): line is string => line !== null,
    );
  switch (status.phase) {
    case "syncing":
      return { label: "Syncing…", details: [], needsSignIn: false };
    case "offline":
      return { label: "Offline", details: orElse(stuck(), "Edits sync when you're back online"), needsSignIn: false };
    case "error":
      return status.lastError === SIGN_IN_AGAIN
        ? { label: SIGN_IN_AGAIN, details: stuck(), needsSignIn: true }
        : { label: "Sync issue, will retry", details: stuck(), needsSignIn: false };
    case "idle":
      return status.pendingOps > 0
        ? { label: `${changes(status.pendingOps)} queued`, details: [], needsSignIn: false }
        : { label: "Everything synced", details: [], needsSignIn: false };
  }
}
