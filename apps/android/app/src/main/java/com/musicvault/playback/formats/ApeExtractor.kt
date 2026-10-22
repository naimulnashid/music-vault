package com.musicvault.playback.formats

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.ParserException
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.SeekPoint
import androidx.media3.extractor.TrackOutput

/**
 * Monkey's Audio (.ape) for ExoPlayer: cuts the file into frames exactly as
 * FFmpeg's ape demuxer does, so the FFmpeg ape decoder in the :ffmpeg module
 * can decode them. Media3 has no APE support of its own.
 *
 * Every sample is one frame with FFmpeg's 8-byte prefix (block count, then the
 * byte skip, both little-endian). Frames overlap by a few bytes (see
 * [ApeFrame]); the overlap is kept in memory rather than reading backwards.
 * The read state is worked out from the input position, so a load that fails
 * part-way through a frame carries on where it stopped.
 */
@OptIn(UnstableApi::class)
class ApeExtractor : Extractor {

    private lateinit var track: TrackOutput
    private lateinit var output: ExtractorOutput
    private var info: ApeStreamInfo? = null

    private var frameIndex = 0
    private var frameBegun = false
    private var sampleSize = 0
    /** The previous frame's last bytes, which are also this frame's first ones. */
    private var carry = ByteArray(0)
    private var carryStart = -1L
    private var tail = ByteArray(0)
    private var tailRead = 0

    override fun sniff(input: ExtractorInput): Boolean {
        if (Id3Skip.peekPast(input) < 0) return false
        val magic = ByteArray(6)
        if (!input.peekFully(magic, 0, magic.size, /* allowEndOfInput= */ true)) return false
        return ApeHeader.isApe(magic)
    }

    override fun init(output: ExtractorOutput) {
        this.output = output
        track = output.track(0, C.TRACK_TYPE_AUDIO)
        output.endTracks()
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int {
        val info = info ?: return readHeader(input)
        if (frameIndex >= info.frames.size) return Extractor.RESULT_END_OF_INPUT
        val frame = info.frames[frameIndex]
        val frameEnd = frame.position + frame.size
        val next = info.frames.getOrNull(frameIndex + 1)
        val tailLength = if (next != null && next.position < frameEnd) (frameEnd - next.position).toInt() else 0

        if (!frameBegun) {
            val position = input.position
            val carried = carryStart == frame.position && position == carryStart + carry.size
            if (!carried) {
                when {
                    position < frame.position -> {
                        input.skipFully((frame.position - position).toInt())
                        return Extractor.RESULT_CONTINUE
                    }
                    position > frame.position -> {
                        clearCarry()
                        seekPosition.position = frame.position
                        return Extractor.RESULT_SEEK
                    }
                }
                clearCarry()
            }
            val prefix = ParsableByteArray(8 + carry.size)
            prefix.data[0] = frame.blocks.toByte()
            prefix.data[1] = (frame.blocks shr 8).toByte()
            prefix.data[2] = (frame.blocks shr 16).toByte()
            prefix.data[3] = (frame.blocks shr 24).toByte()
            prefix.data[4] = frame.skip.toByte()
            prefix.data[5] = (frame.skip shr 8).toByte()
            prefix.data[6] = (frame.skip shr 16).toByte()
            prefix.data[7] = (frame.skip shr 24).toByte()
            carry.copyInto(prefix.data, 8)
            track.sampleData(prefix, prefix.limit())
            sampleSize = prefix.limit()
            clearCarry()
            tail = ByteArray(tailLength)
            tailRead = 0
            frameBegun = true
        }

        val bodyEnd = frameEnd - tailLength
        val remaining = bodyEnd - input.position
        if (remaining > 0) {
            val read = track.sampleData(input, remaining.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(), true)
            if (read == C.RESULT_END_OF_INPUT) return finishFrame(info, endOfInput = true)
            sampleSize += read
            return Extractor.RESULT_CONTINUE
        }
        while (tailRead < tail.size) {
            val read = input.read(tail, tailRead, tail.size - tailRead)
            if (read == C.RESULT_END_OF_INPUT) return finishFrame(info, endOfInput = true)
            tailRead += read
        }
        return finishFrame(info, endOfInput = false)
    }

    private fun finishFrame(info: ApeStreamInfo, endOfInput: Boolean): Int {
        if (tailRead > 0) {
            track.sampleData(ParsableByteArray(tail, tailRead), tailRead)
            sampleSize += tailRead
        }
        val frame = info.frames[frameIndex]
        track.sampleMetadata(info.frameTimeUs(frameIndex), C.BUFFER_FLAG_KEY_FRAME, sampleSize, 0, null)
        carry = tail.copyOf(tailRead)
        carryStart = frame.position + frame.size - tail.size
        frameBegun = false
        sampleSize = 0
        frameIndex++
        return if (endOfInput || frameIndex >= info.frames.size) {
            Extractor.RESULT_END_OF_INPUT
        } else {
            Extractor.RESULT_CONTINUE
        }
    }

    private fun readHeader(input: ExtractorInput): Int {
        val junk = Id3Skip.peekPast(input)
        if (junk < 0) throw ParserException.createForMalformedContainer("ID3 tag runs past the end", null)
        val prefix = ByteArray(ApeHeader.PREFIX_SIZE)
        input.peekFully(prefix, 0, prefix.size)
        val needed = maxOf(ApeHeader.bytesNeeded(prefix), prefix.size)
        val header = prefix.copyOf(needed)
        input.peekFully(header, prefix.size, needed - prefix.size)
        input.resetPeekPosition()
        val info = ApeHeader.parse(header, junk.toLong(), input.length)
        this.info = info

        track.format(
            Format.Builder()
                .setSampleMimeType(FfmpegLibrary.MIME_APE)
                .setChannelCount(info.channels)
                .setSampleRate(info.sampleRate)
                .setMaxInputSize(8 + info.frames.maxOf { it.size })
                // The FFmpeg module's decoder reads the coded bit depth from the second entry.
                .setInitializationData(listOf(info.extraData, byteArrayOf(info.bitsPerSample.toByte())))
                .build(),
        )
        output.seekMap(ApeSeekMap(info))
        return Extractor.RESULT_CONTINUE
    }

    override fun seek(position: Long, timeUs: Long) {
        frameBegun = false
        sampleSize = 0
        clearCarry()
        val info = info ?: return
        // Seek points are frame positions; anything else (a restart from 0) goes by time.
        val index = info.frames.indexOfFirst { it.position == position }
        frameIndex = if (index >= 0) index else info.frameIndexForTimeUs(timeUs)
    }

    override fun release() {}

    private fun clearCarry() {
        carry = ByteArray(0)
        carryStart = -1
    }

    private class ApeSeekMap(private val info: ApeStreamInfo) : SeekMap {
        override fun isSeekable() = true

        override fun getDurationUs() = info.durationUs

        override fun getSeekPoints(timeUs: Long): SeekMap.SeekPoints {
            val index = info.frameIndexForTimeUs(timeUs)
            val point = SeekPoint(info.frameTimeUs(index), info.frames[index].position)
            if (point.timeUs >= timeUs || index == info.frames.size - 1) return SeekMap.SeekPoints(point)
            val after = SeekPoint(info.frameTimeUs(index + 1), info.frames[index + 1].position)
            return SeekMap.SeekPoints(point, after)
        }
    }
}
