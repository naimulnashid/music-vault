package com.musicvault.data.sync

import com.musicvault.domain.model.Track
import java.time.Instant

/**
 * Decouples the data repositories from the sync engine — the Kotlin
 * counterpart of desktop's lib/syncBus.ts. Repositories call [enqueue] on
 * every user mutation; [SyncManager] installs the real enqueue while a
 * signed-in engine is running. Signed out, the calls are no-ops by design.
 */
object SyncBus {

    @Volatile
    private var enqueueFn: ((SyncOpPayload) -> Unit)? = null

    /** This install's devices.id row, used for device-scoped setting ops. */
    @Volatile
    var deviceId: String? = null
        private set

    @Volatile
    private var enqueueUserId: String? = null

    /** Ops that must reach one account's stream once its engine runs (see [enqueueFor]). */
    private val waiting = mutableListOf<Pair<String, SyncOpPayload>>()

    fun install(deviceId: String?, userId: String? = null, fn: (SyncOpPayload) -> Unit) {
        this.deviceId = deviceId
        enqueueFn = fn
        enqueueUserId = userId
        if (userId == null) return
        // A different account signing in drops the waiting ops: they were not its own.
        val ready = synchronized(waiting) {
            waiting.filter { it.first == userId }.map { it.second }.also { waiting.clear() }
        }
        ready.forEach(fn)
    }

    fun uninstall() {
        enqueueFn = null
        enqueueUserId = null
        deviceId = null
    }

    fun enqueue(payload: SyncOpPayload) {
        enqueueFn?.invoke(payload)
    }

    /**
     * Enqueues for one account: now if its engine is running, else as soon as it
     * starts. Used for a play session recovered at startup, before sync is up.
     */
    fun enqueueFor(userId: String, payload: SyncOpPayload) {
        val fn = enqueueFn
        when {
            fn != null && enqueueUserId == userId -> fn(payload)
            fn == null -> synchronized(waiting) { waiting += userId to payload }
        }
    }

    fun nowIso(): String = Instant.now().toString()

    /** Builds the sync TrackRef for a track, or null when it has no identity. */
    fun refFromTrack(track: Track): TrackRef? {
        val ref = TrackRef(
            remoteId = track.remoteId,
            contentHash = track.contentHash,
            fileName = track.fileName,
            fileSize = track.fileSize,
            title = track.title,
            artist = track.artist,
            album = track.album,
            duration = track.durationMs / 1000.0,
        )
        return if (ref.hasIdentity()) ref else null
    }
}
