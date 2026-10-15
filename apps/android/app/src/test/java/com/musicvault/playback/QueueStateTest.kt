package com.musicvault.playback

import com.google.common.truth.Truth.assertThat
import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Track
import org.junit.Test
import kotlin.random.Random

private fun track(id: String) = Track(
    id = id,
    uri = "content://x/$id",
    fileName = "$id.mp3",
    fileSize = 1,
    title = id,
    artist = "Artist",
    album = "Album",
)

private fun tracks(vararg ids: String) = ids.map { track(it) }

class QueueStateTest {

    @Test
    fun `setQueue without shuffle keeps order and start index`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b", "c"), startIndex = 1, shuffle = false)
        assertThat(q.entries.map { it.track.id }).containsExactly("a", "b", "c").inOrder()
        assertThat(q.currentIndex).isEqualTo(1)
        assertThat(q.currentTrack?.id).isEqualTo("b")
    }

    @Test
    fun `setQueue with shuffle puts the tapped track first`() {
        val q = QueueState(Random(42))
        q.setQueue(tracks("a", "b", "c", "d"), startIndex = 2, shuffle = true)
        assertThat(q.currentIndex).isEqualTo(0)
        assertThat(q.currentTrack?.id).isEqualTo("c")
        assertThat(q.entries.map { it.track.id }).containsExactlyElementsIn(listOf("a", "b", "c", "d"))
    }

    @Test
    fun `next moves forward and stops at end with repeat off`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b"), 0, false)
        assertThat(q.next(RepeatMode.OFF)).isEqualTo(AdvanceResult.Move(1))
        assertThat(q.next(RepeatMode.OFF)).isEqualTo(AdvanceResult.EndOfQueue)
        assertThat(q.currentIndex).isEqualTo(1) // stays on last track
    }

    @Test
    fun `next wraps with repeat all and restarts with repeat one`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b"), 1, false)
        assertThat(q.next(RepeatMode.ALL)).isEqualTo(AdvanceResult.Move(0))
        assertThat(q.next(RepeatMode.ONE)).isEqualTo(AdvanceResult.RestartCurrent)
        assertThat(q.currentIndex).isEqualTo(0)
    }

    @Test
    fun `previous restarts when more than three seconds in`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b"), 1, false)
        assertThat(q.previous(positionMs = 5_000)).isEqualTo(AdvanceResult.RestartCurrent)
        assertThat(q.currentIndex).isEqualTo(1)
    }

    @Test
    fun `previous within three seconds goes back and wraps from index zero`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b", "c"), 0, false)
        assertThat(q.previous(positionMs = 1_000)).isEqualTo(AdvanceResult.Move(2))
        assertThat(q.currentTrack?.id).isEqualTo("c")
    }

    @Test
    fun `nextIndexForAdvance mirrors getNextIndex semantics`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b"), 1, false)
        assertThat(q.nextIndexForAdvance(RepeatMode.ONE)).isNull()
        assertThat(q.nextIndexForAdvance(RepeatMode.OFF)).isNull()
        assertThat(q.nextIndexForAdvance(RepeatMode.ALL)).isEqualTo(0)
        q.jumpTo(0)
        assertThat(q.nextIndexForAdvance(RepeatMode.OFF)).isEqualTo(1)
    }

    @Test
    fun `reorder keeps current index pointing at the same track`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b", "c"), 1, false)
        q.reorder(fromIndex = 0, toIndex = 2) // a moves after c: b, c, a
        assertThat(q.entries.map { it.track.id }).containsExactly("b", "c", "a").inOrder()
        assertThat(q.currentIndex).isEqualTo(0)
        assertThat(q.currentTrack?.id).isEqualTo("b")
    }

    @Test
    fun `removing before current shifts index down`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b", "c"), 2, false)
        assertThat(q.removeAt(0)).isEqualTo(RemoveResult.IndexShifted)
        assertThat(q.currentIndex).isEqualTo(1)
        assertThat(q.currentTrack?.id).isEqualTo("c")
    }

    @Test
    fun `removing after current keeps index`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b", "c"), 0, false)
        assertThat(q.removeAt(2)).isEqualTo(RemoveResult.IndexShifted)
        assertThat(q.currentIndex).isEqualTo(0)
    }

    @Test
    fun `removing the current track loads the one now at that index`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b", "c"), 1, false)
        assertThat(q.removeAt(1)).isEqualTo(RemoveResult.CurrentRemoved(1))
        assertThat(q.currentTrack?.id).isEqualTo("c")
    }

    @Test
    fun `removing the last current track clamps to new end`() {
        val q = QueueState()
        q.setQueue(tracks("a", "b"), 1, false)
        assertThat(q.removeAt(1)).isEqualTo(RemoveResult.CurrentRemoved(0))
        assertThat(q.currentTrack?.id).isEqualTo("a")
    }

    @Test
    fun `removing the only track clears the queue`() {
        val q = QueueState()
        q.setQueue(tracks("a"), 0, false)
        assertThat(q.removeAt(0)).isEqualTo(RemoveResult.QueueCleared)
        assertThat(q.isEmpty).isTrue()
        assertThat(q.currentIndex).isEqualTo(-1)
    }

    @Test
    fun `duplicate tracks keep distinct uids across reorder`() {
        val q = QueueState()
        q.setQueue(tracks("a", "a", "b"), 1, false)
        val currentUid = q.entries[1].uid
        q.reorder(2, 0) // b, a, a
        assertThat(q.entries.map { it.track.id }).containsExactly("b", "a", "a").inOrder()
        assertThat(q.entries[q.currentIndex].uid).isEqualTo(currentUid)
    }
}
