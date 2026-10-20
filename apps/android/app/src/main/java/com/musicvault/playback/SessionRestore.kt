package com.musicvault.playback

import com.musicvault.domain.model.Track
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first

/**
 * Works out the previous session's queue and position (web loadLastPlayback).
 * The library is in memory only once sync has read its shadow, so looking the
 * queue up before then finds nothing and the session would be lost.
 */
internal class SessionRestore(
    private val hydrated: Flow<Boolean>,
    private val savedQueue: suspend () -> List<String>,
    private val lastPlayback: suspend () -> Pair<Int, Long>,
    private val tracksByIds: suspend (List<String>) -> List<Track>,
) {
    data class Plan(val tracks: List<Track>, val index: Int, val positionMs: Long)

    /** Suspends until the library is loaded; null when there is nothing to restore. */
    suspend fun plan(): Plan? {
        val queueIds = savedQueue()
        if (queueIds.isEmpty()) return null
        hydrated.first { it }
        val tracks = tracksByIds(queueIds)
        if (tracks.isEmpty()) return null
        val (savedIndex, savedPosition) = lastPlayback()
        // Some queued tracks may have been removed since; re-locate by id.
        val savedId = queueIds.getOrNull(savedIndex)
        val index = tracks.indexOfFirst { it.id == savedId }.takeIf { it >= 0 }
            ?: savedIndex.coerceIn(0, tracks.size - 1)
        return Plan(tracks, index, savedPosition)
    }
}
