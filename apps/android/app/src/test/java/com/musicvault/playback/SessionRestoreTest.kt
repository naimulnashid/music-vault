package com.musicvault.playback

import com.google.common.truth.Truth.assertThat
import com.musicvault.data.sync.RemoteTrackIndex
import com.musicvault.domain.model.Track
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

private fun track(id: String) = Track(
    id = id,
    uri = "vault://$id",
    fileName = "$id.mp3",
    fileSize = 1,
    title = id,
    artist = "Artist",
    album = "Album",
)

@OptIn(ExperimentalCoroutinesApi::class)
class SessionRestoreTest {

    private fun restorer(
        hydrated: MutableStateFlow<Boolean>,
        library: () -> List<Track>,
        queue: List<String> = listOf("a", "b", "c"),
        last: Pair<Int, Long> = 1 to 42_000L,
    ) = SessionRestore(
        hydrated = hydrated,
        savedQueue = { queue },
        lastPlayback = { last },
        tracksByIds = { ids -> library().associateBy { it.id }.let { all -> ids.mapNotNull { all[it] } } },
    )

    @Test
    fun `waits for the library before looking the queue up`() = runTest {
        val hydrated = MutableStateFlow(false)
        var library = emptyList<Track>()
        val plan = async { restorer(hydrated, { library }).plan() }
        runCurrent()
        assertThat(plan.isCompleted).isFalse()

        library = listOf(track("a"), track("b"), track("c"))
        hydrated.value = true
        runCurrent()
        val result = plan.await()!!
        assertThat(result.tracks.map { it.id }).containsExactly("a", "b", "c").inOrder()
        assertThat(result.index).isEqualTo(1)
        assertThat(result.positionMs).isEqualTo(42_000L)
    }

    @Test
    fun `re-locates the saved track when earlier ones were removed`() = runTest {
        val plan = restorer(MutableStateFlow(true), { listOf(track("b"), track("c")) }).plan()!!
        assertThat(plan.tracks.map { it.id }).containsExactly("b", "c").inOrder()
        assertThat(plan.index).isEqualTo(0)
    }

    @Test
    fun `falls back to a clamped index when the saved track is gone`() = runTest {
        val plan = restorer(MutableStateFlow(true), { listOf(track("a")) }, last = 2 to 0L).plan()!!
        assertThat(plan.index).isEqualTo(0)
    }

    @Test
    fun `nothing to restore without a saved queue or surviving tracks`() = runTest {
        assertThat(restorer(MutableStateFlow(true), { listOf(track("a")) }, queue = emptyList()).plan()).isNull()
        assertThat(restorer(MutableStateFlow(true), { emptyList() }).plan()).isNull()
    }

    @Test
    fun `the track index reports loaded once rows are set, and not after clear`() {
        val index = RemoteTrackIndex()
        assertThat(index.loaded.value).isFalse()
        index.set(emptyList())
        assertThat(index.loaded.value).isTrue()
        index.clear()
        assertThat(index.loaded.value).isFalse()
    }
}
