package com.musicvault.data.repo

import com.musicvault.data.db.HistoryDao
import com.musicvault.domain.HistoryData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private const val MAX_HISTORY = 100

data class HistorySnapshot(
    val recentIds: List<String>,
    val playCounts: Map<String, Int>,
    val listenSeconds: Map<String, Long>,
    /** Per-track last play time (epoch ms) — rule engine `lastPlayedAt` field. */
    val lastPlayedAt: Map<String, Long> = emptyMap(),
) {
    fun toHistoryData() = HistoryData(recentIds = recentIds, playCounts = playCounts)
}

/** Replaces the web app's historyStore (localStorage). */
@Singleton
class HistoryRepository @Inject constructor(private val historyDao: HistoryDao) {

    val history: Flow<HistorySnapshot> = historyDao.observeAll().map { rows ->
        HistorySnapshot(
            recentIds = rows.filter { it.lastPlayedAt != null }
                .sortedByDescending { it.lastPlayedAt }
                .take(MAX_HISTORY)
                .map { it.trackId },
            playCounts = rows.filter { it.playCount > 0 }.associate { it.trackId to it.playCount },
            listenSeconds = rows.filter { it.listenSeconds > 0 }.associate { it.trackId to it.listenSeconds },
            lastPlayedAt = rows.mapNotNull { row -> row.lastPlayedAt?.let { row.trackId to it } }.toMap(),
        )
    }

    suspend fun recordPlay(trackId: String) = historyDao.recordPlay(trackId, System.currentTimeMillis())

    suspend fun addListenSeconds(trackId: String, seconds: Long) {
        if (seconds > 0) historyDao.addListenSeconds(trackId, seconds)
    }

    suspend fun clearRecents() = historyDao.clearRecents()
}
