package com.musicvault.playback

import android.content.Context
import com.musicvault.data.sync.SyncJson
import com.musicvault.data.sync.TrackRef
import kotlinx.serialization.Serializable
import java.util.UUID

/**
 * One listening session of one track (web/desktop: lib/playSession.ts). The
 * event id is fixed when it starts, so recording it twice (on stop, then again
 * from the checkpoint at the next start) still yields one event.
 */
@Serializable
data class PlaySession(
    val eventId: String,
    val trackId: String,
    /** Sync identity; null for tracks without one (local log only). */
    val ref: TrackRef?,
    /** The account signed in when it started; its cloud copy goes only to that account. */
    val userId: String?,
    val durationMs: Long,
    val startedAtMs: Long,
    var seconds: Long = 0,
) {
    companion object {
        fun start(trackId: String, ref: TrackRef?, userId: String?, durationMs: Long) =
            PlaySession(UUID.randomUUID().toString(), trackId, ref, userId, durationMs, System.currentTimeMillis())
    }
}

/**
 * The checkpoint is what survives the process being killed: the session as of
 * the last second played, recorded at the next start.
 */
class PlaySessionCheckpoint(context: Context) {
    private val prefs = context.getSharedPreferences("play_session", Context.MODE_PRIVATE)

    fun save(session: PlaySession) {
        prefs.edit().putString(KEY, SyncJson.encodeToString(PlaySession.serializer(), session)).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    fun take(): PlaySession? {
        val raw = prefs.getString(KEY, null) ?: return null
        clear()
        return runCatching { SyncJson.decodeFromString(PlaySession.serializer(), raw) }.getOrNull()
    }

    private companion object {
        const val KEY = "session"
    }
}
