package com.musicvault.domain

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class LrcTest {

    @Test
    fun `parses simple timestamped lines sorted by time`() {
        val lrc = """
            [00:12.00]line one
            [00:05.50]line zero
        """.trimIndent()
        val lines = Lrc.parse(lrc)
        assertThat(lines).hasSize(2)
        assertThat(lines[0].timeMs).isEqualTo(5_500)
        assertThat(lines[0].text).isEqualTo("line zero")
        assertThat(lines[1].timeMs).isEqualTo(12_000)
    }

    @Test
    fun `line with multiple time tags repeats text at each time`() {
        val lines = Lrc.parse("[00:10.00][01:10.00]chorus text")
        assertThat(lines).hasSize(2)
        assertThat(lines[0].timeMs).isEqualTo(10_000)
        assertThat(lines[1].timeMs).isEqualTo(70_000)
        assertThat(lines.all { it.text == "chorus text" }).isTrue()
    }

    @Test
    fun `fractional seconds pad to milliseconds`() {
        // .5 -> 500ms, .55 -> 550ms, .555 -> 555ms
        assertThat(Lrc.parse("[00:01.5]a")[0].timeMs).isEqualTo(1_500)
        assertThat(Lrc.parse("[00:01.55]a")[0].timeMs).isEqualTo(1_550)
        assertThat(Lrc.parse("[00:01.555]a")[0].timeMs).isEqualTo(1_555)
    }

    @Test
    fun `lines without time tags are skipped`() {
        val lrc = """
            [ti:Some Title]
            [ar:Some Artist]
            plain text line
            [00:01.00]real line
        """.trimIndent()
        val lines = Lrc.parse(lrc)
        assertThat(lines).hasSize(1)
        assertThat(lines[0].text).isEqualTo("real line")
    }

    @Test
    fun `findCurrentLineIndex returns last line at or before position`() {
        val lines = listOf(
            LyricLine(1_000, "a"),
            LyricLine(5_000, "b"),
            LyricLine(9_000, "c"),
        )
        assertThat(Lrc.findCurrentLineIndex(lines, 0)).isEqualTo(-1)
        assertThat(Lrc.findCurrentLineIndex(lines, 1_000)).isEqualTo(0)
        assertThat(Lrc.findCurrentLineIndex(lines, 6_500)).isEqualTo(1)
        assertThat(Lrc.findCurrentLineIndex(lines, 99_000)).isEqualTo(2)
    }
}
