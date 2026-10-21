package com.musicvault.playback

import com.google.common.truth.Truth.assertThat
import com.musicvault.data.sync.QueueChange
import com.musicvault.data.sync.TrackIdentity
import com.musicvault.data.sync.TrackRef
import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Track
import org.junit.Test

private fun track(id: String) = Track(
    id = "vault:$id",
    uri = "vault://$id",
    fileName = "$id.flac",
    fileSize = 1,
    title = id,
    artist = "Artist",
    album = "Album",
    contentHash = id,
)

private fun ref(t: Track) = TrackRef(contentHash = t.contentHash, title = t.title)

private fun remote(
    hashes: List<String>,
    current: Int = 0,
    device: String? = "desktop",
    editedAt: String = "2026-10-21T10:00:00Z",
) = QueueChange(
    tracks = hashes.map { TrackIdentity(remoteId = "r-$it", contentHash = it) },
    currentIndex = current,
    positionSeconds = 42.5,
    shuffle = false,
    repeat = "off",
    deviceId = device,
    editedAt = editedAt,
)

private val at10 = java.time.Instant.parse("2026-10-21T10:00:00Z").toEpochMilli()

class QueueHandoffTest {
    private val a = QueueKey(listOf("vault:a", "vault:b"), 0)

    @Test
    fun `queue edits push after 3 s, pauses after half a second, positions never`() {
        assertThat(QueueHandoff.pushDelay(a, a.copy(currentIndex = 1), wasPlaying = true, isPlaying = true)).isEqualTo(3_000L)
        assertThat(QueueHandoff.pushDelay(a, a, wasPlaying = true, isPlaying = false)).isEqualTo(500L)
        assertThat(QueueHandoff.pushDelay(a, a, wasPlaying = true, isPlaying = true)).isNull()
        assertThat(QueueHandoff.pushDelay(a, a, wasPlaying = false, isPlaying = false)).isNull()
    }

    @Test
    fun `the update carries the queue, index, position and modes`() {
        val tracks = listOf(track("a"), track("b"), track("c"))
        val p = QueueHandoff.payload(tracks, 1, 61_500L, shuffle = true, repeat = RepeatMode.ALL, editedAt = "t", refOf = ::ref)!!
        assertThat(p.tracks.map { it.contentHash }).containsExactly("a", "b", "c").inOrder()
        assertThat(p.currentIndex).isEqualTo(1)
        assertThat(p.positionSeconds).isEqualTo(61.5)
        assertThat(p.shuffle).isTrue()
        assertThat(p.repeat).isEqualTo("all")
    }

    @Test
    fun `a cleared queue goes out, an identity-less one doesn't`() {
        val cleared = QueueHandoff.payload(emptyList(), -1, 0, false, RepeatMode.OFF, "t", refOf = ::ref)!!
        assertThat(cleared.tracks).isEmpty()
        assertThat(QueueHandoff.payload(listOf(track("a")), 0, 0, false, RepeatMode.OFF, "t", refOf = { null })).isNull()
    }

    @Test
    fun `the index skips songs that can't go out`() {
        val tracks = listOf(track("a"), track("x"), track("c"))
        val p = QueueHandoff.payload(tracks, 2, 0, false, RepeatMode.OFF, "t", refOf = { if (it.title == "x") null else ref(it) })!!
        assertThat(p.tracks.map { it.contentHash }).containsExactly("a", "c").inOrder()
        assertThat(p.currentIndex).isEqualTo(1)
    }

    @Test
    fun `newest wins between this phone and another device`() {
        val r = remote(listOf("a"))
        assertThat(QueueHandoff.useRemote(r, "phone", hasLocalQueue = true, localActivityMs = at10 - 60_000)).isTrue()
        assertThat(QueueHandoff.useRemote(r, "phone", hasLocalQueue = true, localActivityMs = at10 + 60_000)).isFalse()
    }

    @Test
    fun `an empty phone takes any other device's queue`() {
        assertThat(QueueHandoff.useRemote(remote(listOf("a")), "phone", hasLocalQueue = false, localActivityMs = null)).isTrue()
    }

    @Test
    fun `its own echo, an empty server queue and an unknown local time keep the local queue`() {
        assertThat(QueueHandoff.useRemote(remote(listOf("a"), device = "phone"), "phone", false, null)).isFalse()
        assertThat(QueueHandoff.useRemote(remote(emptyList()), "phone", false, null)).isFalse()
        assertThat(QueueHandoff.useRemote(null, "phone", false, null)).isFalse()
        assertThat(QueueHandoff.useRemote(remote(listOf("a")), "phone", hasLocalQueue = true, localActivityMs = null)).isFalse()
    }

    @Test
    fun `songs not in this library drop out and the current one moves to the next left`() {
        val library = listOf(track("a"), track("c"), track("d")).associateBy { it.contentHash }
        val lookup: (TrackIdentity) -> Track? = { library[it.contentHash] }

        val (tracks, index) = QueueHandoff.resolve(remote(listOf("a", "b", "c", "d"), current = 1), lookup)!!
        assertThat(tracks.map { it.contentHash }).containsExactly("a", "c", "d").inOrder()
        assertThat(index).isEqualTo(1) // b is gone: c, the next one

        assertThat(QueueHandoff.resolve(remote(listOf("a", "c", "zz"), current = 2), lookup)!!.second).isEqualTo(1)
        assertThat(QueueHandoff.resolve(remote(listOf("x", "y")), lookup)).isNull()
    }
}
