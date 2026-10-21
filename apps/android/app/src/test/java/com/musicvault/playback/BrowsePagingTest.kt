package com.musicvault.playback

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class BrowsePagingTest {
    private val items = (0 until 1_201).toList()

    @Test
    fun `pages walk the whole list without repeating`() {
        val pages = (0..3).map { pageOf(items, it, 500) }
        assertThat(pages[0]).isEqualTo((0 until 500).toList())
        assertThat(pages[1]).isEqualTo((500 until 1_000).toList())
        assertThat(pages[2]).isEqualTo((1_000 until 1_201).toList())
        assertThat(pages[3]).isEmpty()
        assertThat(pages.flatten()).isEqualTo(items)
    }

    @Test
    fun `other page sizes line up`() {
        assertThat(pageOf(items, 4, 300)).isEqualTo((1_200 until 1_201).toList())
        assertThat(pageOf(items, 0, 5_000)).isEqualTo(items)
    }

    @Test
    fun `invalid requests return nothing`() {
        assertThat(pageOf(items, -1, 100)).isEmpty()
        assertThat(pageOf(items, 0, 0)).isEmpty()
        assertThat(pageOf(emptyList<Int>(), 0, 100)).isEmpty()
    }

    @Test
    fun `a huge page index does not overflow`() {
        assertThat(pageOf(items, Int.MAX_VALUE, Int.MAX_VALUE)).isEmpty()
    }
}
