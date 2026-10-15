package com.musicvault.data.sync

/**
 * Persisted client-side sync state — Kotlin port of
 * packages/core/src/sync/storage.ts. The production implementation is
 * Room-backed (survives crashes — the "no data loss" invariant); tests use
 * [MemorySyncStorage].
 *
 * Three stores:
 *  - outbox   — pending ops, ordered by createdAt
 *  - cursors  — per-table pull cursors + small flags (e.g. "seeded")
 *  - shadow   — a local mirror of remote rows, keyed (entity, id), payload is
 *               the raw row JSON. Gives offline knowledge of remote state:
 *               track identity mapping, playlist item positions, LWW stamps.
 */
interface SyncStorage {
    suspend fun outboxAll(): List<OutboxEntry>
    suspend fun outboxPut(op: SyncOp)
    suspend fun outboxDelete(ids: List<String>)
    suspend fun outboxBumpAttempts(ids: List<String>)

    suspend fun cursorGet(name: String): String?
    suspend fun cursorSet(name: String, value: String)

    suspend fun shadowGet(entity: String, id: String): String?
    suspend fun shadowPut(entity: String, id: String, payload: String)
    suspend fun shadowDelete(entity: String, id: String)
    suspend fun shadowAll(entity: String): List<ShadowRow>

    /** Wipes outbox, cursors and shadow — used on sign-out/account switch. */
    suspend fun clearAll()
}

data class OutboxEntry(val op: SyncOp, val attempts: Int)

data class ShadowRow(val id: String, val payload: String)

/** In-memory SyncStorage for tests and ephemeral sessions. */
class MemorySyncStorage : SyncStorage {
    private val outbox = LinkedHashMap<String, OutboxEntry>()
    private val cursors = HashMap<String, String>()
    private val shadow = HashMap<String, String>()

    override suspend fun outboxAll(): List<OutboxEntry> =
        outbox.values.sortedWith(compareBy({ it.op.createdAt }, { it.op.id }))

    override suspend fun outboxPut(op: SyncOp) {
        outbox[op.id] = OutboxEntry(op, outbox[op.id]?.attempts ?: 0)
    }

    override suspend fun outboxDelete(ids: List<String>) {
        for (id in ids) outbox.remove(id)
    }

    override suspend fun outboxBumpAttempts(ids: List<String>) {
        for (id in ids) {
            val entry = outbox[id] ?: continue
            outbox[id] = entry.copy(attempts = entry.attempts + 1)
        }
    }

    override suspend fun cursorGet(name: String): String? = cursors[name]

    override suspend fun cursorSet(name: String, value: String) {
        cursors[name] = value
    }

    override suspend fun shadowGet(entity: String, id: String): String? = shadow["$entity $id"]

    override suspend fun shadowPut(entity: String, id: String, payload: String) {
        shadow["$entity $id"] = payload
    }

    override suspend fun shadowDelete(entity: String, id: String) {
        shadow.remove("$entity $id")
    }

    override suspend fun shadowAll(entity: String): List<ShadowRow> {
        val prefix = "$entity "
        return shadow.entries
            .filter { it.key.startsWith(prefix) }
            .map { ShadowRow(it.key.removePrefix(prefix), it.value) }
    }

    override suspend fun clearAll() {
        outbox.clear()
        cursors.clear()
        shadow.clear()
    }
}
