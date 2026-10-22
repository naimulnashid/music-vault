package com.musicvault.playback.formats

import androidx.media3.common.ParserException

/**
 * One Monkey's Audio frame as FFmpeg's ape demuxer cuts it (libavformat/ape.c,
 * FFmpeg 6.0): the decoder wants each frame starting on a 4-byte boundary
 * counted from the first frame, so [position] may sit up to 3 bytes before the
 * frame's real start, [skip] says how many bytes that is, and [size] is rounded
 * up to a multiple of 4. Neighbouring frames therefore overlap by a few bytes.
 */
data class ApeFrame(val position: Long, val size: Int, val blocks: Int, val skip: Int)

class ApeStreamInfo(
    val fileVersion: Int,
    val compressionType: Int,
    val formatFlags: Int,
    val blocksPerFrame: Int,
    val bitsPerSample: Int,
    val channels: Int,
    val sampleRate: Int,
    val totalSamples: Long,
    val frames: List<ApeFrame>,
) {
    val durationUs: Long get() = totalSamples * 1_000_000 / sampleRate

    fun frameTimeUs(index: Int): Long = index.toLong() * blocksPerFrame * 1_000_000 / sampleRate

    fun frameIndexForTimeUs(timeUs: Long): Int =
        (timeUs.coerceAtLeast(0) * sampleRate / 1_000_000 / blocksPerFrame)
            .coerceAtMost(frames.size - 1L).toInt()

    /** The 6 bytes FFmpeg's ape decoder takes as extradata. */
    val extraData: ByteArray
        get() = byteArrayOf(
            fileVersion.toByte(), (fileVersion shr 8).toByte(),
            compressionType.toByte(), (compressionType shr 8).toByte(),
            formatFlags.toByte(), (formatFlags shr 8).toByte(),
        )
}

/** Port of ape_read_header() from FFmpeg 6.0's libavformat/ape.c. */
object ApeHeader {
    const val MIN_VERSION = 3800
    const val MAX_VERSION = 3990

    /** Enough bytes from the "MAC " tag for [bytesNeeded] to work out the rest. */
    const val PREFIX_SIZE = 40

    private const val FLAG_8_BIT = 1
    private const val FLAG_HAS_PEAK_LEVEL = 4
    private const val FLAG_24_BIT = 8
    private const val FLAG_HAS_SEEK_ELEMENTS = 16
    private const val FLAG_CREATE_WAV_HEADER = 32

    fun isApe(bytes: ByteArray): Boolean {
        if (bytes.size < 6 || bytes[0] != 'M'.code.toByte() || bytes[1] != 'A'.code.toByte() ||
            bytes[2] != 'C'.code.toByte() || bytes[3] != ' '.code.toByte()
        ) return false
        return u16(bytes, 4) in MIN_VERSION..MAX_VERSION
    }

    /** How many bytes from the "MAC " tag [parse] reads, given the first [PREFIX_SIZE] of them. */
    fun bytesNeeded(prefix: ByteArray): Int {
        val version = u16(prefix, 4)
        if (version >= 3980) {
            // Descriptor, header and seek table; the WAV header comes after them.
            val total = u32(prefix, 8) + u32(prefix, 12) + u32(prefix, 16)
            if (total > Int.MAX_VALUE) throw malformed("APE header too large")
            return total.toInt()
        }
        val flags = u16(prefix, 8)
        val wavHeaderLength = u32(prefix, 16)
        val totalFrames = u32(prefix, 24)
        var headerLength = 32
        var cursor = 32
        if (flags and FLAG_HAS_PEAK_LEVEL != 0) { headerLength += 4; cursor += 4 }
        val seekTableLength = if (flags and FLAG_HAS_SEEK_ELEMENTS != 0) {
            headerLength += 4
            u32(prefix, cursor) * 4
        } else {
            totalFrames * 4
        }
        var total = headerLength + seekTableLength
        if (flags and FLAG_CREATE_WAV_HEADER == 0) total += wavHeaderLength
        if (version < 3810) total += seekTableLength / 4 // the bit table, after a quirky skip
        if (total > Int.MAX_VALUE) throw malformed("APE header too large")
        return total.toInt()
    }

    /**
     * @param bytes the file from the "MAC " tag on, at least [bytesNeeded] long.
     * @param junkLength where the tag starts in the file (after any ID3v2 tag).
     * @param fileLength the file's length, or a negative value when unknown.
     */
    fun parse(bytes: ByteArray, junkLength: Long, fileLength: Long): ApeStreamInfo {
        if (!isApe(bytes)) throw malformed("Not a supported APE file")
        val r = Reader(bytes, 4)
        val fileVersion = r.u16()
        val descriptorLength: Long
        val headerLength: Long
        val seekTableLength: Long
        val wavHeaderLength: Long
        val wavTailLength: Long
        val compressionType: Int
        val formatFlags: Int
        val blocksPerFrame: Long
        val finalFrameBlocks: Long
        val totalFrames: Long
        val bps: Int
        val channels: Int
        val sampleRate: Long
        if (fileVersion >= 3980) {
            r.u16() // padding
            descriptorLength = r.u32()
            headerLength = r.u32()
            seekTableLength = r.u32()
            wavHeaderLength = r.u32()
            r.u32() // audio data length
            r.u32() // audio data length, high
            wavTailLength = r.u32()
            r.skip(16) // MD5
            if (descriptorLength > 52) r.skip((descriptorLength - 52).toInt())
            compressionType = r.u16()
            formatFlags = r.u16()
            blocksPerFrame = r.u32()
            finalFrameBlocks = r.u32()
            totalFrames = r.u32()
            bps = r.u16()
            channels = r.u16()
            sampleRate = r.u32()
            // The header can be longer than the fields above; the seek table follows it.
            r.seek((descriptorLength + headerLength).toInt())
        } else {
            descriptorLength = 0
            var hl = 32L
            compressionType = r.u16()
            formatFlags = r.u16()
            channels = r.u16()
            sampleRate = r.u32()
            wavHeaderLength = r.u32()
            wavTailLength = r.u32()
            totalFrames = r.u32()
            finalFrameBlocks = r.u32()
            if (formatFlags and FLAG_HAS_PEAK_LEVEL != 0) { r.skip(4); hl += 4 }
            seekTableLength = if (formatFlags and FLAG_HAS_SEEK_ELEMENTS != 0) {
                hl += 4
                r.u32() * 4
            } else {
                totalFrames * 4
            }
            headerLength = hl
            bps = when {
                formatFlags and FLAG_8_BIT != 0 -> 8
                formatFlags and FLAG_24_BIT != 0 -> 24
                else -> 16
            }
            blocksPerFrame = when {
                fileVersion >= 3950 -> 73728L * 4
                fileVersion >= 3900 || (fileVersion >= 3800 && compressionType >= 4000) -> 73728L
                else -> 9216L
            }
            if (formatFlags and FLAG_CREATE_WAV_HEADER == 0) r.skip(wavHeaderLength.toInt())
        }

        if (totalFrames == 0L) throw malformed("No frames in the APE file")
        if (totalFrames > 0x7FFFFFF) throw malformed("Too many APE frames: $totalFrames")
        if (seekTableLength / 4 < totalFrames) {
            throw malformed("APE seek table has ${seekTableLength / 4} entries for $totalFrames frames")
        }
        if (channels !in 1..2 || sampleRate <= 0 || blocksPerFrame <= 0) {
            throw malformed("APE stream: $channels channels at $sampleRate Hz")
        }
        val frameCount = totalFrames.toInt()

        var firstFrame = junkLength + descriptorLength + headerLength + seekTableLength + wavHeaderLength
        if (fileVersion < 3810) firstFrame += totalFrames

        val pos = LongArray(frameCount)
        val size = LongArray(frameCount)
        val skip = IntArray(frameCount)
        pos[0] = firstFrame
        r.u32() // seektable[0]
        for (i in 1 until frameCount) {
            pos[i] = r.u32() + junkLength
            size[i - 1] = pos[i] - pos[i - 1]
            skip[i] = ((pos[i] - pos[0]) and 3).toInt()
            if (pos[i] < pos[i - 1]) throw malformed("APE seek table goes backwards at frame $i")
        }
        // FFmpeg skips this many *bytes* (not entries); kept as is so the bit table lines up the same.
        r.skip((seekTableLength / 4 - totalFrames).toInt())

        val last = frameCount - 1
        var finalSize = 0L
        if (fileLength > 0) {
            finalSize = fileLength - pos[last] - wavTailLength
            finalSize -= finalSize and 3
        }
        if (fileLength <= 0 || finalSize <= 0) finalSize = finalFrameBlocks * 8
        size[last] = finalSize

        for (i in 0 until frameCount) {
            if (skip[i] != 0) {
                pos[i] -= skip[i]
                size[i] += skip[i]
            }
            if (size[i] > Int.MAX_VALUE - 3 - 8) throw malformed("APE frame $i is too large")
            size[i] = (size[i] + 3) and 3L.inv()
        }
        if (fileVersion < 3810) {
            for (i in 0 until frameCount) {
                val bits = r.u8()
                if (i > 0 && bits != 0) size[i - 1] += 4
                skip[i] = (skip[i] shl 3) + bits
            }
        }

        val frames = List(frameCount) { i ->
            val blocks = if (i == last) finalFrameBlocks else blocksPerFrame
            if (size[i] <= 0) throw malformed("APE frame $i has no data")
            ApeFrame(pos[i], size[i].toInt(), blocks.toInt(), skip[i])
        }
        val totalSamples = finalFrameBlocks + if (frameCount > 1) blocksPerFrame * (frameCount - 1) else 0
        return ApeStreamInfo(
            fileVersion = fileVersion,
            compressionType = compressionType,
            formatFlags = formatFlags,
            blocksPerFrame = blocksPerFrame.toInt(),
            bitsPerSample = bps,
            channels = channels,
            sampleRate = sampleRate.toInt(),
            totalSamples = totalSamples,
            frames = frames,
        )
    }

    private fun malformed(message: String) = ParserException.createForMalformedContainer(message, null)

    private fun u16(b: ByteArray, at: Int): Int = (b[at].toInt() and 0xFF) or ((b[at + 1].toInt() and 0xFF) shl 8)

    private fun u32(b: ByteArray, at: Int): Long = (u16(b, at).toLong()) or (u16(b, at + 2).toLong() shl 16)

    private class Reader(private val b: ByteArray, private var at: Int) {
        private fun need(n: Int) {
            if (n < 0 || at + n > b.size) throw malformed("APE header is truncated")
        }
        fun u8(): Int { need(1); return b[at++].toInt() and 0xFF }
        fun u16(): Int { need(2); return u16(b, at).also { at += 2 } }
        fun u32(): Long { need(4); return u32(b, at).also { at += 4 } }
        fun skip(n: Int) { need(n); at += n }
        fun seek(to: Int) { if (to > at) skip(to - at) }
    }
}
