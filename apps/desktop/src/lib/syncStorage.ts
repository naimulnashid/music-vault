import type { OutboxEntry, SyncOp, SyncStorage } from "@musicvault/core";
import {
  syncClearAll,
  syncCursorGet,
  syncCursorSet,
  syncOutboxAll,
  syncOutboxBump,
  syncOutboxDelete,
  syncOutboxPut,
  syncShadowAll,
  syncShadowDelete,
  syncShadowGet,
  syncShadowPut,
} from "./ipc";

/**
 * SyncStorage over the Rust SQLite tables (sync_outbox / sync_cursors /
 * sync_shadow) — queued mutations survive crashes and restarts.
 */
export class TauriSyncStorage implements SyncStorage {
  async outboxAll(): Promise<OutboxEntry[]> {
    const rows = await syncOutboxAll();
    return rows.map((row) => ({ op: JSON.parse(row.payload) as SyncOp, attempts: row.attempts }));
  }

  async outboxPut(op: SyncOp): Promise<void> {
    await syncOutboxPut(op.id, op.createdAt, JSON.stringify(op));
  }

  async outboxDelete(ids: string[]): Promise<void> {
    if (ids.length > 0) await syncOutboxDelete(ids);
  }

  async outboxBumpAttempts(ids: string[]): Promise<void> {
    if (ids.length > 0) await syncOutboxBump(ids);
  }

  cursorGet(name: string): Promise<string | null> {
    return syncCursorGet(name);
  }

  async cursorSet(name: string, value: string): Promise<void> {
    await syncCursorSet(name, value);
  }

  shadowGet(entity: string, id: string): Promise<string | null> {
    return syncShadowGet(entity, id);
  }

  async shadowPut(entity: string, id: string, payload: string): Promise<void> {
    await syncShadowPut(entity, id, payload);
  }

  async shadowDelete(entity: string, id: string): Promise<void> {
    await syncShadowDelete(entity, id);
  }

  shadowAll(entity: string): Promise<Array<{ id: string; payload: string }>> {
    return syncShadowAll(entity);
  }

  async clearAll(): Promise<void> {
    await syncClearAll();
  }
}
