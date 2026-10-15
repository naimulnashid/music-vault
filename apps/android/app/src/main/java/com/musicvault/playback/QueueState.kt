package com.musicvault.playback

import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Track
import kotlin.random.Random

/** One queue slot. [uid] stays stable across reorders (a track can appear twice). */
data class QueueEntry(val uid: Long, val track: Track)

sealed interface AdvanceResult {
    /** Move to this queue index. */
    data class Move(val index: Int) : AdvanceResult

    /** Restart the current track from 0 (repeat-one, or prev while >3s in). */
    data object RestartCurrent : AdvanceResult

    /** End of queue with repeat off: stay on the current track, paused. */
    data object EndOfQueue : AdvanceResult

    /** Nothing to do (empty queue). */
    data object None : AdvanceResult
}

sealed interface RemoveResult {
    data object QueueCleared : RemoveResult
    data object IndexShifted : RemoveResult

    /** The playing entry itself was removed; load the track now at [newIndex]. */
    data class CurrentRemoved(val newIndex: Int) : RemoveResult

    data object None : RemoveResult
}

/**
 * Pure port of the web playerStore queue logic (playerStore.ts) so it can be
 * unit-tested without any Android dependency.
 */
class QueueState(private val random: Random = Random.Default) {

    var entries: List<QueueEntry> = emptyList()
        private set
    var currentIndex: Int = -1
        private set

    private var nextUid = 1L

    val currentTrack: Track?
        get() = entries.getOrNull(currentIndex)?.track

    val isEmpty: Boolean get() = entries.isEmpty()

    private fun entryOf(track: Track) = QueueEntry(uid = nextUid++, track = track)

    /** playQueue: shuffle-on-start keeps the tapped track first (web behavior). */
    fun setQueue(tracks: List<Track>, startIndex: Int, shuffle: Boolean) {
        if (tracks.isEmpty()) {
            clear()
            return
        }
        val start = tracks[startIndex]
        if (shuffle) {
            val rest = tracks.filterIndexed { i, _ -> i != startIndex }.shuffled(random)
            entries = (listOf(start) + rest).map { entryOf(it) }
            currentIndex = 0
        } else {
            entries = tracks.map { entryOf(it) }
            currentIndex = startIndex
        }
    }

    fun restore(tracks: List<Track>, index: Int) {
        entries = tracks.map { entryOf(it) }
        currentIndex = index.coerceIn(-1, entries.size - 1)
    }

    /** Index the next auto/gapless/crossfade transition should target, or null. */
    fun nextIndexForAdvance(repeat: RepeatMode): Int? {
        if (entries.isEmpty() || repeat == RepeatMode.ONE) return null
        val n = currentIndex + 1
        return when {
            n < entries.size -> n
            repeat == RepeatMode.ALL -> 0
            else -> null
        }
    }

    fun next(repeat: RepeatMode): AdvanceResult {
        if (entries.isEmpty()) return AdvanceResult.None
        if (repeat == RepeatMode.ONE) return AdvanceResult.RestartCurrent
        val nextIndex = nextIndexForAdvance(repeat) ?: return AdvanceResult.EndOfQueue
        currentIndex = nextIndex
        return AdvanceResult.Move(nextIndex)
    }

    fun previous(positionMs: Long): AdvanceResult {
        if (entries.isEmpty()) return AdvanceResult.None
        if (positionMs > 3_000) return AdvanceResult.RestartCurrent
        val prevIndex = if (currentIndex - 1 < 0) entries.size - 1 else currentIndex - 1
        currentIndex = prevIndex
        return AdvanceResult.Move(prevIndex)
    }

    fun jumpTo(index: Int): Boolean {
        if (index < 0 || index >= entries.size) return false
        currentIndex = index
        return true
    }

    /** Used when a crossfade/gapless transition already started the next track. */
    fun markAdvancedTo(index: Int) {
        if (index in entries.indices) currentIndex = index
    }

    /** Inserts tracks at [index] (clamped); the current entry stays current. */
    fun insert(tracks: List<Track>, index: Int) {
        if (tracks.isEmpty()) return
        val at = index.coerceIn(0, entries.size)
        val next = entries.toMutableList()
        next.addAll(at, tracks.map(::entryOf))
        entries = next
        if (currentIndex >= at) currentIndex += tracks.size
    }

    fun reorder(fromIndex: Int, toIndex: Int) {
        if (fromIndex == toIndex || fromIndex < 0 || toIndex < 0) return
        if (fromIndex >= entries.size || toIndex >= entries.size) return
        val currentUid = entries.getOrNull(currentIndex)?.uid
        val next = entries.toMutableList()
        val moved = next.removeAt(fromIndex)
        next.add(toIndex, moved)
        entries = next
        currentIndex = if (currentUid != null) next.indexOfFirst { it.uid == currentUid } else -1
    }

    fun removeAt(index: Int): RemoveResult {
        if (index < 0 || index >= entries.size) return RemoveResult.None
        val next = entries.filterIndexed { i, _ -> i != index }
        if (next.isEmpty()) {
            clear()
            return RemoveResult.QueueCleared
        }
        return when {
            index < currentIndex -> {
                entries = next
                currentIndex -= 1
                RemoveResult.IndexShifted
            }
            index > currentIndex -> {
                entries = next
                RemoveResult.IndexShifted
            }
            else -> {
                entries = next
                currentIndex = minOf(currentIndex, next.size - 1)
                RemoveResult.CurrentRemoved(currentIndex)
            }
        }
    }

    fun clear() {
        entries = emptyList()
        currentIndex = -1
    }
}
