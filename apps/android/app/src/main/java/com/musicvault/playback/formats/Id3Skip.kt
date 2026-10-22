package com.musicvault.playback.formats

import androidx.media3.extractor.ExtractorInput

/**
 * APE and WavPack files are tagged at the end, but taggers sometimes put an
 * ID3v2 tag in front as well; FFmpeg skips it before probing, and so do we.
 */
internal object Id3Skip {

    /**
     * Peeks past any ID3v2 tags at the read position and returns their total
     * length, leaving the peek position after them, or -1 when the input ends
     * inside a tag.
     */
    fun peekPast(input: ExtractorInput): Int {
        input.resetPeekPosition()
        var total = 0
        val header = ByteArray(10)
        while (true) {
            if (!input.peekFully(header, 0, 10, /* allowEndOfInput= */ true)) {
                input.resetPeekPosition()
                input.advancePeekPosition(total)
                return total
            }
            if (header[0] != 'I'.code.toByte() || header[1] != 'D'.code.toByte() || header[2] != '3'.code.toByte()) {
                input.resetPeekPosition()
                input.advancePeekPosition(total)
                return total
            }
            // Syncsafe size of the body, plus the 10-byte footer when flagged.
            val body = ((header[6].toInt() and 0x7F) shl 21) or ((header[7].toInt() and 0x7F) shl 14) or
                ((header[8].toInt() and 0x7F) shl 7) or (header[9].toInt() and 0x7F)
            val footer = if (header[5].toInt() and 0x10 != 0) 10 else 0
            total += 10 + body + footer
            if (!input.advancePeekPosition(body + footer, /* allowEndOfInput= */ true)) {
                input.resetPeekPosition()
                return -1
            }
        }
    }
}
