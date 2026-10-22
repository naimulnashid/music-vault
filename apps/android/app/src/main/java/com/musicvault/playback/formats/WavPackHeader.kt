package com.musicvault.playback.formats

import androidx.media3.common.ParserException

/** The 32-byte header that starts every WavPack block. */
data class WavPackBlockHeader(
    /** Bytes after the header. */
    val bodySize: Int,
    val version: Int,
    /** Samples in the whole file, or -1 when the encoder didn't know (a stream). */
    val totalSamples: Long,
    val blockIndex: Long,
    val samples: Long,
    val flags: Int,
) {
    val totalSize: Int get() = WavPackHeader.HEADER_SIZE + bodySize
    val isInitial: Boolean get() = flags and WavPackHeader.FLAG_INITIAL_BLOCK != 0
    val isFinal: Boolean get() = flags and WavPackHeader.FLAG_FINAL_BLOCK != 0
    val isDsd: Boolean get() = flags and WavPackHeader.FLAG_DSD != 0
    val rateIndex: Int get() = (flags ushr 23) and 0xF
    val bitsPerSample: Int get() = if (isDsd) 0 else ((flags and 3) + 1) * 8
}

class WavPackStreamInfo(
    val version: Int,
    val sampleRate: Int,
    val channels: Int,
    val bitsPerSample: Int,
    /** -1 when unknown. */
    val totalSamples: Long,
    /** From the first audio block; later blocks of the same file match it. */
    val rateIndex: Int,
) {
    val durationUs: Long get() = if (totalSamples < 0) -1 else totalSamples * 1_000_000 / sampleRate

    fun timeUs(sample: Long): Long = sample * 1_000_000 / sampleRate

    /** True when [header] can belong to this stream: guards resyncing against "wvpk" inside audio data. */
    fun matches(header: WavPackBlockHeader): Boolean =
        header.samples > 0 &&
            header.rateIndex == rateIndex &&
            header.bitsPerSample == bitsPerSample &&
            (totalSamples < 0 || (header.totalSamples == totalSamples && header.blockIndex < totalSamples))

    /** The two bytes FFmpeg's wv demuxer gives the decoder as extradata. */
    val extraData: ByteArray get() = byteArrayOf(version.toByte(), (version shr 8).toByte())
}

/** Port of the block header parsing in FFmpeg 6.0's libavformat/wv.c and wvdec.c. */
object WavPackHeader {
    const val HEADER_SIZE = 32
    const val FLAG_MONO = 0x4
    const val FLAG_INITIAL_BLOCK = 1 shl 11
    const val FLAG_FINAL_BLOCK = 1 shl 12
    const val FLAG_DSD = 1 shl 31
    private const val BLOCK_LIMIT = 1_048_576
    private const val MAX_SAMPLES = 150_000 // the decoder's WV_MAX_SAMPLES
    private const val MIN_VERSION = 0x402
    private const val MAX_VERSION = 0x410

    private val RATES = intArrayOf(
        6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000,
        32000, 44100, 48000, 64000, 88200, 96000, 192000, -1,
    )

    /** The header at [at], or null when there isn't a valid one there. */
    fun parse(b: ByteArray, at: Int = 0): WavPackBlockHeader? {
        if (b.size - at < HEADER_SIZE) return null
        if (b[at] != 'w'.code.toByte() || b[at + 1] != 'v'.code.toByte() ||
            b[at + 2] != 'p'.code.toByte() || b[at + 3] != 'k'.code.toByte()
        ) return null
        val chunkSize = u32(b, at + 4)
        if (chunkSize < 24 || chunkSize > BLOCK_LIMIT) return null
        val version = u16(b, at + 8)
        if (version < MIN_VERSION || version > MAX_VERSION) return null
        val total = u32(b, at + 12)
        val samples = u32(b, at + 20)
        if (samples > MAX_SAMPLES) return null
        return WavPackBlockHeader(
            bodySize = (chunkSize - 24).toInt(),
            version = version,
            totalSamples = if (total == 0xFFFFFFFFL) -1 else total,
            blockIndex = u32(b, at + 16),
            samples = samples,
            flags = u32(b, at + 24).toInt(),
        )
    }

    /** Whether [streamInfo] needs the block body: a custom rate, several channels, or DSD. */
    fun needsBody(header: WavPackBlockHeader): Boolean =
        RATES[header.rateIndex] == -1 || !(header.isInitial && header.isFinal) || header.isDsd

    /** Stream parameters from the first block that has samples, as wv_read_block_header() works them out. */
    fun streamInfo(header: WavPackBlockHeader, body: ByteArray?): WavPackStreamInfo {
        var rate = RATES[header.rateIndex]
        var rateMultiplier = if (header.isDsd) 4 else 1
        val multichannel = !(header.isInitial && header.isFinal)
        var channels = if (multichannel) 0 else if (header.flags and FLAG_MONO != 0) 1 else 2
        if (needsBody(header)) {
            val b = body ?: throw malformed("WavPack block body needed")
            var at = 0
            while (at + 2 <= b.size) {
                val id = b[at].toInt() and 0xFF
                var size: Int
                if (id and 0x80 != 0) {
                    if (at + 4 > b.size) break
                    size = (b[at + 1].toInt() and 0xFF) or ((b[at + 2].toInt() and 0xFF) shl 8) or
                        ((b[at + 3].toInt() and 0xFF) shl 16)
                    at += 4
                } else {
                    size = b[at + 1].toInt() and 0xFF
                    at += 2
                }
                size = size shl 1
                val odd = id and 0x40 != 0
                if (odd) size--
                if (size < 0 || at + size > b.size) break
                when (id and 0x3F) {
                    0xD -> { // channel info
                        if (size <= 1) throw malformed("Insufficient WavPack channel information")
                        channels = b[at].toInt() and 0xFF
                        if (size - 2 == 4 || size - 2 == 5) {
                            channels = (channels or ((b[at + 2].toInt() and 0xF) shl 8)) + 1
                        } else if (size - 2 !in 0..3) {
                            throw malformed("Invalid WavPack channel info size $size")
                        }
                    }
                    0xE -> { // DSD block
                        if (size <= 1) throw malformed("Invalid WavPack DSD block")
                        rateMultiplier = 1 shl (b[at].toInt() and 0x1F)
                    }
                    0x27 -> if (size >= 3) rate = u24(b, at) // custom sample rate
                }
                at += size + if (odd) 1 else 0
            }
        }
        if (rate == -1 || rate.toLong() * rateMultiplier >= Int.MAX_VALUE) {
            throw malformed("Cannot determine the WavPack sample rate")
        }
        if (channels <= 0) throw malformed("Cannot determine the WavPack channel count")
        return WavPackStreamInfo(
            version = header.version,
            sampleRate = rate * rateMultiplier,
            channels = channels,
            bitsPerSample = header.bitsPerSample,
            totalSamples = header.totalSamples,
            rateIndex = header.rateIndex,
        )
    }

    private fun malformed(message: String) = ParserException.createForMalformedContainer(message, null)

    private fun u16(b: ByteArray, at: Int): Int = (b[at].toInt() and 0xFF) or ((b[at + 1].toInt() and 0xFF) shl 8)

    private fun u24(b: ByteArray, at: Int): Int = u16(b, at) or ((b[at + 2].toInt() and 0xFF) shl 16)

    private fun u32(b: ByteArray, at: Int): Long = u16(b, at).toLong() or (u16(b, at + 2).toLong() shl 16)
}
