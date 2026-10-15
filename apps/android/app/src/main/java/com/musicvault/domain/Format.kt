package com.musicvault.domain

/** Port of format.ts. */
object Format {
    fun formatTime(ms: Long): String {
        if (ms < 0) return "0:00"
        val totalSeconds = ms / 1000
        val mins = totalSeconds / 60
        val secs = totalSeconds % 60
        return "$mins:${secs.toString().padStart(2, '0')}"
    }

    /** "1.4 GB", "213 MB", "8.2 KB" — binary units, one decimal below 100. */
    fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        var value = bytes.toDouble()
        val units = listOf("KB", "MB", "GB", "TB")
        var unit = -1
        while (value >= 1024 && unit < units.size - 1) {
            value /= 1024
            unit++
        }
        return if (value >= 100) "${value.toInt()} ${units[unit]}"
        else String.format(java.util.Locale.US, "%.1f %s", value, units[unit])
    }

    /** Formats a duration as a human string like "2h 14m" or "36m 4s" or "42s". */
    fun formatDurationLong(seconds: Long): String {
        if (seconds < 0) return "0s"
        val hrs = seconds / 3600
        val mins = (seconds % 3600) / 60
        val secs = seconds % 60
        return when {
            hrs > 0 -> "${hrs}h ${mins}m"
            mins > 0 -> "${mins}m ${secs}s"
            else -> "${secs}s"
        }
    }
}
