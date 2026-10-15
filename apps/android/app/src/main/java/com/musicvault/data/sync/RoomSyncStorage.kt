package com.musicvault.data.sync

import com.musicvault.data.db.SyncCursorEntity
import com.musicvault.data.db.SyncDao
import com.musicvault.data.db.SyncOutboxEntity
import com.musicvault.data.db.SyncShadowEntity
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Room-backed [SyncStorage]: the outbox is persisted SQLite and survives
 * crashes — the "no data loss" invariant of docs/sync-protocol.md.
 */
@Singleton
class RoomSyncStorage @Inject constructor(private val dao: SyncDao) : SyncStorage {

    override suspend fun outboxAll(): List<OutboxEntry> =
        dao.outboxAll().map { row ->
            OutboxEntry(SyncJson.decodeFromString(SyncOp.serializer(), row.payload), row.attempts)
        }

    override suspend fun outboxPut(op: SyncOp) {
        dao.outboxPut(
            SyncOutboxEntity(
                id = op.id,
                createdAt = op.createdAt,
                payload = SyncJson.encodeToString(SyncOp.serializer(), op),
                attempts = dao.outboxAttempts(op.id) ?: 0,
            ),
        )
    }

    override suspend fun outboxDelete(ids: List<String>) {
        if (ids.isNotEmpty()) dao.outboxDelete(ids)
    }

    override suspend fun outboxBumpAttempts(ids: List<String>) {
        if (ids.isNotEmpty()) dao.outboxBumpAttempts(ids)
    }

    override suspend fun cursorGet(name: String): String? = dao.cursorGet(name)

    override suspend fun cursorSet(name: String, value: String) {
        dao.cursorSet(SyncCursorEntity(name, value))
    }

    override suspend fun shadowGet(entity: String, id: String): String? = dao.shadowGet(entity, id)

    override suspend fun shadowPut(entity: String, id: String, payload: String) {
        dao.shadowPut(SyncShadowEntity(entity, id, payload))
    }

    override suspend fun shadowDelete(entity: String, id: String) {
        dao.shadowDelete(entity, id)
    }

    override suspend fun shadowAll(entity: String): List<ShadowRow> =
        dao.shadowAll(entity).map { ShadowRow(it.id, it.payload) }

    override suspend fun clearAll() {
        dao.clearAll()
    }
}
