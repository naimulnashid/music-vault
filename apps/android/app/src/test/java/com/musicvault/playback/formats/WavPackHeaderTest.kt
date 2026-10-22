package com.musicvault.playback.formats

import androidx.media3.common.ParserException
import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test

class WavPackHeaderTest {

    private fun block(
        bodySize: Int = 100,
        version: Int = 0x410,
        total: Long = 441_000,
        index: Long = 0,
        samples: Long = 22_050,
        flags: Int = INITIAL or FINAL or (9 shl 23) or 1, // 44.1 kHz, 16-bit, stereo
    ): ByteArray {
        val b = ByteArray(32)
        fun u32(at: Int, v: Long) { for (i in 0..3) b[at + i] = (v shr (8 * i)).toByte() }
        "wvpk".toByteArray().copyInto(b)
        u32(4, bodySize + 24L)
        b[8] = version.toByte()
        b[9] = (version shr 8).toByte()
        u32(12, total)
        u32(16, index)
        u32(20, samples)
        u32(24, flags.toLong() and 0xFFFFFFFFL)
        return b
    }

    @Test
    fun `parses a stereo block`() {
        val h = WavPackHeader.parse(block())!!
        assertThat(h.bodySize).isEqualTo(100)
        assertThat(h.totalSize).isEqualTo(132)
        assertThat(h.samples).isEqualTo(22_050)
        assertThat(h.isInitial && h.isFinal).isTrue()
        assertThat(h.bitsPerSample).isEqualTo(16)
        val info = WavPackHeader.streamInfo(h, null)
        assertThat(info.sampleRate).isEqualTo(44_100)
        assertThat(info.channels).isEqualTo(2)
        assertThat(info.durationUs).isEqualTo(10_000_000)
        assertThat(info.extraData.toList()).containsExactly(0x10.toByte(), 0x04.toByte()).inOrder()
    }

    @Test
    fun `mono and 24-bit come from the flags`() {
        val h = WavPackHeader.parse(block(flags = INITIAL or FINAL or (10 shl 23) or 2 or WavPackHeader.FLAG_MONO))!!
        val info = WavPackHeader.streamInfo(h, null)
        assertThat(info.channels).isEqualTo(1)
        assertThat(info.bitsPerSample).isEqualTo(24)
        assertThat(info.sampleRate).isEqualTo(48_000)
    }

    @Test
    fun `rejects bad magic, sizes and versions`() {
        assertThat(WavPackHeader.parse(block().also { it[0] = 'x'.code.toByte() })).isNull()
        assertThat(WavPackHeader.parse(block(version = 0x401))).isNull()
        assertThat(WavPackHeader.parse(block(bodySize = 2_000_000))).isNull()
        assertThat(WavPackHeader.parse(block(samples = 200_000))).isNull()
        assertThat(WavPackHeader.parse(block().copyOf(31))).isNull()
    }

    @Test
    fun `an unknown total is -1 and leaves the duration unknown`() {
        val h = WavPackHeader.parse(block(total = 0xFFFFFFFFL))!!
        assertThat(h.totalSamples).isEqualTo(-1)
        assertThat(WavPackHeader.streamInfo(h, null).durationUs).isEqualTo(-1)
    }

    @Test
    fun `a custom sample rate is read from the metadata`() {
        val h = WavPackHeader.parse(block(flags = INITIAL or FINAL or (15 shl 23) or 1))!!
        assertThat(WavPackHeader.needsBody(h)).isTrue()
        // A 2-byte decorrelation sub-block to step over, then ID_SAMPLE_RATE (0x27,
        // with the odd-size flag: 0x67, 3 bytes + pad) holding 352800.
        val body = byteArrayOf(0x02, 1, 0, 0, 0x67, 2, 0x20, 0x62, 0x05, 0)
        assertThat(WavPackHeader.streamInfo(h, body).sampleRate).isEqualTo(352_800)
    }

    @Test
    fun `a custom rate without its metadata is rejected`() {
        val h = WavPackHeader.parse(block(flags = INITIAL or FINAL or (15 shl 23) or 1))!!
        assertThrows(ParserException::class.java) { WavPackHeader.streamInfo(h, ByteArray(0)) }
    }

    @Test
    fun `multichannel counts come from the channel info`() {
        // First block of a 6-channel frame: initial but not final.
        val h = WavPackHeader.parse(block(flags = INITIAL or (9 shl 23) or 1))!!
        assertThat(WavPackHeader.needsBody(h)).isTrue()
        // ID_CHANNEL_INFO (0xD), 2 words: 6 channels, mask 0x3F, pad.
        val body = byteArrayOf(0x0D, 2, 6, 0x3F, 0, 0)
        assertThat(WavPackHeader.streamInfo(h, body).channels).isEqualTo(6)
    }

    @Test
    fun `matches keeps resyncs on blocks of the same stream`() {
        val info = WavPackHeader.streamInfo(WavPackHeader.parse(block())!!, null)
        assertThat(info.matches(WavPackHeader.parse(block(index = 22_050))!!)).isTrue()
        assertThat(info.matches(WavPackHeader.parse(block(total = 1))!!)).isFalse()
        assertThat(info.matches(WavPackHeader.parse(block(index = 441_000))!!)).isFalse()
        assertThat(info.matches(WavPackHeader.parse(block(flags = INITIAL or FINAL or (10 shl 23) or 1))!!)).isFalse()
        assertThat(info.matches(WavPackHeader.parse(block(samples = 0))!!)).isFalse()
    }

    private companion object {
        const val INITIAL = WavPackHeader.FLAG_INITIAL_BLOCK
        const val FINAL = WavPackHeader.FLAG_FINAL_BLOCK
    }
}
