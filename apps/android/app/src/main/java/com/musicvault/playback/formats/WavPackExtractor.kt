package com.musicvault.playback.formats

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.ParserException
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.extractor.BinarySearchSeeker
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput

/**
 * WavPack (.wv) for ExoPlayer, read the way FFmpeg's wv demuxer reads it: one
 * sample per frame, which is every block from an initial block to the next
 * final one (one block for mono or stereo), headers included. Blocks without
 * samples carry only metadata and are skipped.
 *
 * WavPack has no seek table, but every block header carries its first sample
 * number, so seeking is a binary search over the file like Media3's FLAC
 * extractor does without a SEEKTABLE.
 */
@OptIn(UnstableApi::class)
class WavPackExtractor : Extractor {

    private lateinit var track: TrackOutput
    private lateinit var output: ExtractorOutput
    private var info: WavPackStreamInfo? = null
    private var seeker: WavPackSeeker? = null

    private val headerBuffer = ByteArray(WavPackHeader.HEADER_SIZE)
    private val scanBuffer = ByteArray(SCAN_CHUNK)
    /** Bytes of the current block still to copy, or 0 between blocks. */
    private var blockRemaining = 0
    private var blockIsFinal = false
    private var sampleSize = 0
    private var sampleTimeUs = 0L

    override fun sniff(input: ExtractorInput): Boolean {
        if (Id3Skip.peekPast(input) < 0) return false
        if (!input.peekFully(headerBuffer, 0, headerBuffer.size, /* allowEndOfInput= */ true)) return false
        return WavPackHeader.parse(headerBuffer) != null
    }

    override fun init(output: ExtractorOutput) {
        this.output = output
        track = output.track(0, C.TRACK_TYPE_AUDIO)
        output.endTracks()
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int {
        val info = info ?: return readHeader(input)
        seeker?.let { if (it.isSeeking) return it.handlePendingSeek(input, seekPosition) }

        if (blockRemaining == 0) {
            if (!input.peekFully(headerBuffer, 0, headerBuffer.size, /* allowEndOfInput= */ true)) {
                return Extractor.RESULT_END_OF_INPUT
            }
            input.resetPeekPosition()
            val header = WavPackHeader.parse(headerBuffer)?.takeIf { it.samples == 0L || info.matches(it) }
            if (header == null) {
                // Trailing tags, or junk: look for the next block, or stop if there isn't one.
                sampleSize = 0
                if (!skipToNextBlock(input, info, requireInitial = true)) return Extractor.RESULT_END_OF_INPUT
                return Extractor.RESULT_CONTINUE
            }
            if (header.samples == 0L || (sampleSize == 0 && !header.isInitial)) {
                // Metadata only, or the middle of a frame we joined late.
                input.skipFully(header.totalSize)
                return Extractor.RESULT_CONTINUE
            }
            if (sampleSize == 0) sampleTimeUs = info.timeUs(header.blockIndex)
            blockRemaining = header.totalSize
            blockIsFinal = header.isFinal
        }

        val read = track.sampleData(input, blockRemaining, /* allowEndOfInput= */ true)
        if (read == C.RESULT_END_OF_INPUT) return Extractor.RESULT_END_OF_INPUT
        blockRemaining -= read
        sampleSize += read
        if (blockRemaining == 0 && blockIsFinal) {
            track.sampleMetadata(sampleTimeUs, C.BUFFER_FLAG_KEY_FRAME, sampleSize, 0, null)
            sampleSize = 0
        }
        return Extractor.RESULT_CONTINUE
    }

    private fun readHeader(input: ExtractorInput): Int {
        val junk = Id3Skip.peekPast(input)
        if (junk < 0) throw ParserException.createForMalformedContainer("ID3 tag runs past the end", null)
        var position = junk.toLong()
        while (true) {
            input.peekFully(headerBuffer, 0, headerBuffer.size)
            val header = WavPackHeader.parse(headerBuffer)
                ?: throw ParserException.createForMalformedContainer("No WavPack block at $position", null)
            if (header.samples == 0L) {
                input.advancePeekPosition(header.bodySize)
                position += header.totalSize
                continue
            }
            val body = if (WavPackHeader.needsBody(header)) {
                ByteArray(header.bodySize).also { input.peekFully(it, 0, it.size) }
            } else {
                null
            }
            input.resetPeekPosition()
            val info = WavPackHeader.streamInfo(header, body)
            this.info = info

            track.format(
                Format.Builder()
                    .setSampleMimeType(FfmpegLibrary.MIME_WAVPACK)
                    .setChannelCount(info.channels)
                    .setSampleRate(info.sampleRate)
                    .setInitializationData(listOf(info.extraData, byteArrayOf(info.bitsPerSample.toByte())))
                    .build(),
            )
            val length = input.length
            val seekMap = if (info.totalSamples > 0 && length != C.LENGTH_UNSET.toLong()) {
                WavPackSeeker(info, position, length, header.totalSize).also { seeker = it }.seekMap
            } else {
                SeekMap.Unseekable(if (info.durationUs > 0) info.durationUs else C.TIME_UNSET)
            }
            output.seekMap(seekMap)
            return Extractor.RESULT_CONTINUE
        }
    }

    override fun seek(position: Long, timeUs: Long) {
        blockRemaining = 0
        sampleSize = 0
        if (position != 0L) seeker?.setSeekTargetUs(timeUs)
    }

    override fun release() {}

    private fun skipToNextBlock(input: ExtractorInput, info: WavPackStreamInfo, requireInitial: Boolean): Boolean {
        input.resetPeekPosition()
        input.advancePeekPosition(1, /* allowEndOfInput= */ true) || return false
        findBlock(input, info, requireInitial, scanBuffer) ?: return false
        input.skipFully((input.peekPosition - input.position).toInt())
        input.resetPeekPosition()
        return true
    }

    /** Binary search over block headers, after Media3's FlacBinarySearchSeeker. */
    private class WavPackSeeker(
        info: WavPackStreamInfo,
        firstBlockPosition: Long,
        inputLength: Long,
        firstBlockSize: Int,
    ) : BinarySearchSeeker(
        SeekTimestampConverter { timeUs -> timeUs * info.sampleRate / 1_000_000 },
        WavPackTimestampSeeker(info),
        info.durationUs,
        /* floorTimePosition= */ 0,
        /* ceilingTimePosition= */ info.totalSamples,
        /* floorBytePosition= */ firstBlockPosition,
        /* ceilingBytePosition= */ inputLength,
        /* approxBytesPerFrame= */ firstBlockSize.toLong(),
        /* minimumSearchRange= */ firstBlockSize,
    ) {
        // Nested here: TimestampSeeker is protected in BinarySearchSeeker.
        private class WavPackTimestampSeeker(private val info: WavPackStreamInfo) : TimestampSeeker {
            private val scratch = ByteArray(SCAN_CHUNK)

            override fun searchForTimestamp(input: ExtractorInput, targetTimestamp: Long): TimestampSearchResult {
                val searchPosition = input.position
                val left = findBlock(input, info, requireInitial = true, scratch)
                val leftSample = left?.blockIndex ?: info.totalSamples
                val leftPosition = input.peekPosition
                if (left != null) input.advancePeekPosition(left.totalSize, /* allowEndOfInput= */ true)
                val right = if (left != null) findBlock(input, info, requireInitial = true, scratch) else null
                val rightSample = right?.blockIndex ?: info.totalSamples
                val rightPosition = input.peekPosition
                return when {
                    leftSample <= targetTimestamp && rightSample > targetTimestamp ->
                        TimestampSearchResult.targetFoundResult(leftPosition)
                    rightSample <= targetTimestamp ->
                        TimestampSearchResult.underestimatedResult(rightSample, rightPosition)
                    else ->
                        TimestampSearchResult.overestimatedResult(leftSample, searchPosition)
                }
            }
        }
    }

    private companion object {
        const val SCAN_CHUNK = 16 * 1024

        /**
         * Scans forward from the peek position for a block header that fits [info],
         * leaving the peek position on it. Returns null at the end of the input.
         */
        fun findBlock(
            input: ExtractorInput,
            info: WavPackStreamInfo,
            requireInitial: Boolean,
            buffer: ByteArray,
        ): WavPackBlockHeader? {
            while (true) {
                val start = input.peekPosition
                var filled = 0
                while (filled < buffer.size) {
                    val n = input.peek(buffer, filled, buffer.size - filled)
                    if (n == C.RESULT_END_OF_INPUT) break
                    filled += n
                }
                for (i in 0..filled - WavPackHeader.HEADER_SIZE) {
                    if (buffer[i] != 'w'.code.toByte()) continue
                    val header = WavPackHeader.parse(buffer, i) ?: continue
                    if (!info.matches(header) || (requireInitial && !header.isInitial)) continue
                    moveTo(input, start + i)
                    return header
                }
                if (filled < buffer.size) {
                    moveTo(input, start + filled)
                    return null
                }
                // Carry the last few bytes over: a header can straddle two chunks.
                moveTo(input, start + filled - WavPackHeader.HEADER_SIZE + 1)
            }
        }

        private fun moveTo(input: ExtractorInput, peekPosition: Long) {
            input.resetPeekPosition()
            input.advancePeekPosition((peekPosition - input.position).toInt())
        }
    }
}
