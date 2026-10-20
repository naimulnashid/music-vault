package com.musicvault.ui

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class TabSelectionTest {
    private val tabs = listOf("tracks", "collections", "downloads", "stats")

    private fun selected(vararg stack: String) = selectedTabRoute(tabs, "tracks") { it in stack }

    @Test
    fun `an album opened from Library search stays under Library`() {
        assertThat(selected("tracks", "search", "album/x")).isEqualTo("tracks")
    }

    @Test
    fun `an album opened from Collections stays under Collections`() {
        assertThat(selected("tracks", "collections", "album/x")).isEqualTo("collections")
    }

    @Test
    fun `pages above another tab root follow that tab`() {
        assertThat(selected("tracks", "stats", "heatmap")).isEqualTo("stats")
        assertThat(selected("tracks", "downloads")).isEqualTo("downloads")
    }

    @Test
    fun `an empty stack falls back to the start tab`() {
        assertThat(selected()).isEqualTo("tracks")
    }
}
