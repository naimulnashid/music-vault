package com.musicvault.data.sync

import com.google.common.truth.Truth.assertThat
import org.junit.After
import org.junit.Test

class SyncBusTest {
    private val op = SyncOpPayload.PlayEventAdd(
        eventId = "e1",
        track = TrackRef(remoteId = "t1"),
        playedAt = "2026-10-20T00:00:00Z",
        durationPlayed = 30.0,
        completed = false,
    )

    @After
    fun tearDown() = SyncBus.uninstall()

    @Test
    fun `an op waits for its account's engine and is sent once`() {
        SyncBus.enqueueFor("user-a", op)
        val sent = mutableListOf<SyncOpPayload>()
        SyncBus.install("device", "user-a") { sent += it }
        assertThat(sent).containsExactly(op)
        SyncBus.uninstall()
        SyncBus.install("device", "user-a") { sent += it }
        assertThat(sent).hasSize(1)
    }

    @Test
    fun `a waiting op is dropped when a different account signs in`() {
        SyncBus.enqueueFor("user-a", op)
        val sent = mutableListOf<SyncOpPayload>()
        SyncBus.install("device", "user-b") { sent += it }
        assertThat(sent).isEmpty()
    }
}
