package com.musicvault.domain

/** One synced lyric line. Port of lrc.ts. */
data class LyricLine(val timeMs: Long, val text: String)

object Lrc {
    private val TIME_TAG = Regex("""\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?]""")

    fun parse(content: String): List<LyricLine> {
        val lines = mutableListOf<LyricLine>()
        for (rawLine in content.split(Regex("\r?\n"))) {
            val tags = TIME_TAG.findAll(rawLine).toList()
            if (tags.isEmpty()) continue
            val text = rawLine.replace(TIME_TAG, "").trim()
            for (tag in tags) {
                val minutes = tag.groupValues[1].toLong()
                val seconds = tag.groupValues[2].toLong()
                val fraction = tag.groupValues[3]
                val millis = if (fraction.isNotEmpty()) fraction.padEnd(3, '0').toLong() else 0L
                lines.add(LyricLine(timeMs = minutes * 60_000 + seconds * 1_000 + millis, text = text))
            }
        }
        return lines.sortedBy { it.timeMs }
    }

    /** Index of the line active at [positionMs], or -1 before the first line. */
    fun findCurrentLineIndex(lines: List<LyricLine>, positionMs: Long): Int {
        var index = -1
        for (i in lines.indices) {
            if (lines[i].timeMs <= positionMs) index = i else break
        }
        return index
    }
}
