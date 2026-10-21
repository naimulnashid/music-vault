package com.musicvault.playback

import com.musicvault.data.sync.QueueChange
import com.musicvault.data.sync.SyncBus
import com.musicvault.data.sync.SyncOpPayload
import com.musicvault.data.sync.TrackIdentity
import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Track
import java.time.OffsetDateTime

/** What a queue push compares: the songs in order and the current one. */
internal data class QueueKey(val trackIds: List<String>, val currentIndex: Int) {
    companion object {
        val EMPTY = QueueKey(emptyList(), -1)
    }
}

/**
 * Cross-device queue handoff (web syncStore: scheduleQueuePush, maybeRestoreQueue).
 * Android keeps its own queue across restarts, so at startup the newest of that and
 * the account's server queue wins, instead of web's "only when nothing is loaded".
 */
internal object QueueHandoff {
    /** After a queue or current-song change (web QUEUE_PUSH_MS). */
    const val CHANGE_DELAY_MS = 3_000L

    /** After a pause, so another device can pick up right here. */
    const val PAUSE_DELAY_MS = 500L

    /**
     * How long to push after a rebuild, comparing with the previous rebuild's state; null
     * for no push, which leaves any pending push running. Positions alone never push.
     */
    fun pushDelay(previous: QueueKey, next: QueueKey, wasPlaying: Boolean, isPlaying: Boolean): Long? = when {
        next != previous -> CHANGE_DELAY_MS
        wasPlaying && !isPlaying -> PAUSE_DELAY_MS
        else -> null
    }

    /**
     * The queue update for the current state, or null when it must not go out: a queue
     * whose songs all lack a sync identity isn't a cleared queue and mustn't wipe the row.
     */
    fun payload(
        tracks: List<Track>,
        currentIndex: Int,
        positionMs: Long,
        shuffle: Boolean,
        repeat: RepeatMode,
        editedAt: String,
        refOf: (Track) -> com.musicvault.data.sync.TrackRef? = SyncBus::refFromTrack,
    ): SyncOpPayload.QueueSet? {
        val refs = tracks.map(refOf)
        val kept = refs.filterNotNull()
        if (kept.isEmpty() && tracks.isNotEmpty()) return null
        // The index into the refs that go out: songs before it without an identity drop out.
        val index = refs.take(currentIndex.coerceAtLeast(0)).count { it != null }.coerceAtMost((kept.size - 1).coerceAtLeast(0))
        return SyncOpPayload.QueueSet(
            tracks = kept,
            currentIndex = index,
            positionSeconds = positionMs / 1000.0,
            shuffle = shuffle,
            repeat = repeat.name.lowercase(),
            editedAt = editedAt,
        )
    }

    /**
     * Whether the server queue should replace this phone's at startup: another device
     * wrote it after this phone last played or edited its queue. With no local queue any
     * other device's queue wins; with a local queue but no recorded time (an install from
     * before this existed) the local one stays.
     */
    fun useRemote(remote: QueueChange?, ownDeviceId: String?, hasLocalQueue: Boolean, localActivityMs: Long?): Boolean {
        if (remote == null || remote.tracks.isEmpty()) return false
        if (remote.deviceId != null && remote.deviceId == ownDeviceId) return false
        if (!hasLocalQueue) return true
        val remoteMs = runCatching { OffsetDateTime.parse(remote.editedAt).toInstant().toEpochMilli() }.getOrNull()
            ?: return false
        return localActivityMs != null && remoteMs > localActivityMs
    }

    /**
     * The server queue's songs that are in this library, and the current one among them.
     * A missing current song falls to the next one still there, else the last.
     */
    fun resolve(remote: QueueChange, lookup: (TrackIdentity) -> Track?): Pair<List<Track>, Int>? {
        val found = remote.tracks.mapIndexedNotNull { i, identity -> lookup(identity)?.let { i to it } }
        if (found.isEmpty()) return null
        val index = found.indexOfFirst { it.first >= remote.currentIndex }.takeIf { it >= 0 } ?: found.lastIndex
        return found.map { it.second } to index
    }
}
