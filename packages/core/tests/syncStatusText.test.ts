import { describe, expect, it } from "vitest";
import { SIGN_IN_AGAIN, describeSyncStatus, type SyncStatus } from "../src/sync";

const now = new Date(2026, 9, 21, 15, 0);
const status = (s: Partial<SyncStatus>): SyncStatus => ({
  phase: "idle",
  pendingOps: 0,
  lastSyncAt: null,
  lastError: null,
  ...s,
});

describe("describeSyncStatus", () => {
  it("a server error says edits are kept and when sync last worked", () => {
    const t = describeSyncStatus(
      status({ phase: "error", pendingOps: 3, lastSyncAt: new Date(2026, 9, 21, 10, 42).toISOString(), lastError: "boom" }),
      now,
    );
    expect(t.label).toBe("Sync issue, will retry");
    expect(t.details[0]).toBe("3 changes kept on this device");
    expect(t.details[1]).toMatch(/^Last synced \S/);
    expect(t.needsSignIn).toBe(false);
  });

  it("an expired session asks for sign-in instead of promising a retry", () => {
    const t = describeSyncStatus(status({ phase: "error", pendingOps: 1, lastError: SIGN_IN_AGAIN }), now);
    expect(t).toEqual({ label: SIGN_IN_AGAIN, details: ["1 change kept on this device"], needsSignIn: true });
  });

  it("offline with nothing waiting shows only how stale this device is", () => {
    const t = describeSyncStatus(status({ phase: "offline", lastSyncAt: new Date(2026, 9, 19, 9, 0).toISOString() }), now);
    expect(t.label).toBe("Offline");
    expect(t.details).toHaveLength(1);
    expect(t.details[0]).toMatch(/^Last synced /);
  });

  it("offline with nothing known says what happens to edits", () => {
    expect(describeSyncStatus(status({ phase: "offline" }), now).details).toEqual(["Edits sync when you're back online"]);
  });

  it("an error before any sync has succeeded has no detail", () => {
    expect(describeSyncStatus(status({ phase: "error", lastError: "boom" }), now).details).toEqual([]);
  });

  it("healthy states keep one line", () => {
    expect(describeSyncStatus(status({}), now)).toEqual({ label: "Everything synced", details: [], needsSignIn: false });
    expect(describeSyncStatus(status({ pendingOps: 2 }), now).label).toBe("2 changes queued");
    expect(describeSyncStatus(status({ phase: "syncing", pendingOps: 2 }), now).details).toEqual([]);
  });
});
