import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { OutboxEntry, SyncOp, SyncStorage } from "@musicvault/core";

interface SyncDB extends DBSchema {
  outbox: {
    key: string;
    value: { id: string; createdAt: string; attempts: number; payload: string };
  };
  cursors: {
    key: string;
    value: { name: string; value: string };
  };
  shadow: {
    key: [string, string];
    value: { entity: string; id: string; payload: string };
    indexes: { "by-entity": string };
  };
}

let dbPromise: Promise<IDBPDatabase<SyncDB>> | null = null;

function getDb(): Promise<IDBPDatabase<SyncDB>> {
  dbPromise ??= openDB<SyncDB>("mv-sync", 1, {
    upgrade(db) {
      db.createObjectStore("outbox", { keyPath: "id" });
      db.createObjectStore("cursors", { keyPath: "name" });
      const shadow = db.createObjectStore("shadow", { keyPath: ["entity", "id"] });
      shadow.createIndex("by-entity", "entity");
    },
  });
  return dbPromise;
}

/**
 * SyncStorage over IndexedDB — queued mutations survive tab closes and
 * reloads (the "no data loss" invariant on the web).
 */
export class IdbSyncStorage implements SyncStorage {
  async outboxAll(): Promise<OutboxEntry[]> {
    const db = await getDb();
    const rows = await db.getAll("outbox");
    return rows
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((row) => ({ op: JSON.parse(row.payload) as SyncOp, attempts: row.attempts }));
  }

  async outboxPut(op: SyncOp): Promise<void> {
    const db = await getDb();
    const existing = await db.get("outbox", op.id);
    await db.put("outbox", {
      id: op.id,
      createdAt: op.createdAt,
      attempts: existing?.attempts ?? 0,
      payload: JSON.stringify(op),
    });
  }

  async outboxDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const tx = db.transaction("outbox", "readwrite");
    for (const id of ids) void tx.store.delete(id);
    await tx.done;
  }

  async outboxBumpAttempts(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const tx = db.transaction("outbox", "readwrite");
    for (const id of ids) {
      const row = await tx.store.get(id);
      if (row) void tx.store.put({ ...row, attempts: row.attempts + 1 });
    }
    await tx.done;
  }

  async cursorGet(name: string): Promise<string | null> {
    const db = await getDb();
    return (await db.get("cursors", name))?.value ?? null;
  }

  async cursorSet(name: string, value: string): Promise<void> {
    const db = await getDb();
    await db.put("cursors", { name, value });
  }

  async shadowGet(entity: string, id: string): Promise<string | null> {
    const db = await getDb();
    return (await db.get("shadow", [entity, id]))?.payload ?? null;
  }

  async shadowPut(entity: string, id: string, payload: string): Promise<void> {
    const db = await getDb();
    await db.put("shadow", { entity, id, payload });
  }

  async shadowDelete(entity: string, id: string): Promise<void> {
    const db = await getDb();
    await db.delete("shadow", [entity, id]);
  }

  async shadowAll(entity: string): Promise<Array<{ id: string; payload: string }>> {
    const db = await getDb();
    const rows = await db.getAllFromIndex("shadow", "by-entity", entity);
    return rows.map(({ id, payload }) => ({ id, payload }));
  }

  async clearAll(): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(["outbox", "cursors", "shadow"], "readwrite");
    void tx.objectStore("outbox").clear();
    void tx.objectStore("cursors").clear();
    void tx.objectStore("shadow").clear();
    await tx.done;
  }
}
