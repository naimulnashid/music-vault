package com.musicvault.playback

import com.google.common.truth.Truth.assertThat
import com.musicvault.data.sync.SyncJson
import com.musicvault.data.sync.TrackRef
import org.junit.Test

class PlaySessionTest {
    @Test
    fun `every session gets its own event id`() {
        val a = PlaySession.start("t1", null, null, 200_000)
        val b = PlaySession.start("t1", null, null, 200_000)
        assertThat(a.eventId).isNotEqualTo(b.eventId)
    }

    @Test
    fun `a checkpointed session comes back with the same event id and seconds`() {
        val s = PlaySession.start("t1", TrackRef(remoteId = "t1"), "user-a", 200_000).apply { seconds = 42 }
        val back = SyncJson.decodeFromString(PlaySession.serializer(), SyncJson.encodeToString(PlaySession.serializer(), s))
        assertThat(back).isEqualTo(s)
        assertThat(back.seconds).isEqualTo(42)
    }
}
