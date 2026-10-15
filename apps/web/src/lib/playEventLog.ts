import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { StatsEvent } from "@musicvault/core";

/**
 * The device-local play-event log (Phase 7 statistics source). Lives in its
 * own IndexedDB ("mv-stats"), separate from the sync engine's "mv-sync":
 * listening history is device-owned and deliberately survives sign-out,
 * unlike sync state. Event ids are shared with the playEvent.add sync ops so
 * merged sources dedupe.
 */

interface StatsDB extends DBSchema {
  playEvents: {
    key: string;
    value: StatsEvent;
    indexes: { "by-time": number };
  };
}

let dbPromise: Promise<IDBPDatabase<StatsDB>> | null = null;

function getDb(): Promise<IDBPDatabase<StatsDB>> {
  dbPromise ??= openDB<StatsDB>("mv-stats", 1, {
    upgrade(db) {
      const store = db.createObjectStore("playEvents", { keyPath: "id" });
      store.createIndex("by-time", "playedAt");
    },
  });
  return dbPromise;
}

/** Idempotent append: re-adding an existing event id is a no-op. */
export async function addPlayEvent(event: StatsEvent): Promise<void> {
  const db = await getDb();
  const existing = await db.get("playEvents", event.id);
  if (!existing) await db.add("playEvents", event);
}

export async function allPlayEvents(): Promise<StatsEvent[]> {
  const db = await getDb();
  return db.getAllFromIndex("playEvents", "by-time");
}
