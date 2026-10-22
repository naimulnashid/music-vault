package com.musicvault.playback.formats

import androidx.media3.common.ParserException
import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream

class ApeHeaderTest {

    /** A v3.99 header: 52-byte descriptor, 24-byte header, seek table, 44-byte WAV header. */
    private fun header(
        seekTable: List<Long>,
        finalFrameBlocks: Int = 1000,
        blocksPerFrame: Int = 73728,
        compression: Int = 2000,
        bps: Int = 16,
    ): ByteArray {
        val out = ByteArrayOutputStream()
        fun u16(v: Int) { out.write(v and 0xFF); out.write((v shr 8) and 0xFF) }
        fun u32(v: Long) { u16((v and 0xFFFF).toInt()); u16(((v shr 16) and 0xFFFF).toInt()) }
        out.write("MAC ".toByteArray())
        u16(3990)
        u16(0)
        u32(52) // descriptor
        u32(24) // header
        u32(seekTable.size * 4L)
        u32(44) // WAV header
        u32(0)
        u32(0)
        u32(0) // WAV tail
        out.write(ByteArray(16))
        u16(compression)
        u16(0) // flags
        u32(blocksPerFrame.toLong())
        u32(finalFrameBlocks.toLong())
        u32(seekTable.size.toLong())
        u16(bps)
        u16(2)
        u32(44100)
        seekTable.forEach { u32(it) }
        return out.toByteArray()
    }

    // First frame right after the headers: 52 + 24 + 12 + 44.
    private val first = 132L
    private val threeFrames = header(listOf(first, first + 1001, first + 2003))

    @Test
    fun `recognises the tag and supported versions only`() {
        assertThat(ApeHeader.isApe(threeFrames)).isTrue()
        assertThat(ApeHeader.isApe("MAC ".toByteArray() + byteArrayOf(0x10, 0x27))).isFalse() // 10000
        assertThat(ApeHeader.isApe("fLaC\u0000\u0000".toByteArray())).isFalse()
    }

    @Test
    fun `bytes needed covers descriptor, header and seek table`() {
        assertThat(ApeHeader.bytesNeeded(threeFrames.copyOf(ApeHeader.PREFIX_SIZE))).isEqualTo(52 + 24 + 12)
    }

    @Test
    fun `frames are aligned and padded the way FFmpeg cuts them`() {
        val info = ApeHeader.parse(threeFrames, junkLength = 0, fileLength = 3000)
        // Frame 1 starts 1001 bytes after frame 0, 1 past a 4-byte boundary, so it
        // is read from 1 byte earlier with skip = 1; sizes round up to 4.
        assertThat(info.frames).containsExactly(
            ApeFrame(position = 132, size = 1004, blocks = 73728, skip = 0),
            ApeFrame(position = 1132, size = 1004, blocks = 73728, skip = 1),
            ApeFrame(position = 2132, size = 868, blocks = 1000, skip = 3),
        ).inOrder()
        assertThat(info.totalSamples).isEqualTo(73728L * 2 + 1000)
        assertThat(info.durationUs).isEqualTo((73728L * 2 + 1000) * 1_000_000 / 44100)
        assertThat(info.bitsPerSample).isEqualTo(16)
        assertThat(info.channels).isEqualTo(2)
    }

    @Test
    fun `the last frame runs to the end of the file`() {
        val info = ApeHeader.parse(threeFrames, junkLength = 0, fileLength = 3000)
        val last = info.frames.last()
        assertThat(last.position + last.size).isEqualTo(3000)
    }

    @Test
    fun `an unknown length falls back to 8 bytes a block for the last frame`() {
        val info = ApeHeader.parse(threeFrames, junkLength = 0, fileLength = -1)
        assertThat(info.frames.last().size).isEqualTo(8004) // 1000 * 8 + skip 3, rounded up
    }

    @Test
    fun `a leading ID3 tag shifts every frame`() {
        val info = ApeHeader.parse(threeFrames, junkLength = 10, fileLength = 3010)
        assertThat(info.frames.map { it.position }).containsExactly(142L, 1142L, 2142L).inOrder()
    }

    @Test
    fun `extradata is version, compression level and flags`() {
        val info = ApeHeader.parse(header(listOf(first), compression = 5000), 0, 500)
        assertThat(info.extraData.toList())
            .containsExactly(0x96.toByte(), 0x0F.toByte(), 0x88.toByte(), 0x13.toByte(), 0.toByte(), 0.toByte())
            .inOrder()
    }

    @Test
    fun `a single frame holds the final block count`() {
        val info = ApeHeader.parse(header(listOf(first), finalFrameBlocks = 500), 0, 1000)
        assertThat(info.frames.single().blocks).isEqualTo(500)
        assertThat(info.totalSamples).isEqualTo(500)
    }

    @Test
    fun `seek lookups land on the frame holding the time`() {
        val info = ApeHeader.parse(threeFrames, 0, 3000)
        val frameUs = 73728L * 1_000_000 / 44100
        assertThat(info.frameIndexForTimeUs(0)).isEqualTo(0)
        assertThat(info.frameIndexForTimeUs(frameUs + 1)).isEqualTo(1)
        assertThat(info.frameIndexForTimeUs(Long.MAX_VALUE / 1_000_000)).isEqualTo(2)
        assertThat(info.frameTimeUs(2)).isEqualTo(2 * 73728L * 1_000_000 / 44100)
    }

    @Test
    fun `a seek table that goes backwards is rejected`() {
        assertThrows(ParserException::class.java) {
            ApeHeader.parse(header(listOf(first, first + 1000, first + 500)), 0, 3000)
        }
    }

    @Test
    fun `a truncated header is rejected`() {
        assertThrows(ParserException::class.java) {
            ApeHeader.parse(threeFrames.copyOf(80), 0, 3000)
        }
    }
}
