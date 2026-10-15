package com.musicvault.domain

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Statistics 2.0 — pure aggregation over the append-only play-event stream.
 * 1:1 port of packages/core/src/stats.ts; both engines are verified against
 * docs/fixtures/stats.golden.json. Do not change semantics here without
 * updating the TypeScript engine AND the fixtures.
 */

// ---- inputs -----------------------------------------------------------------

/** One playback session (mirrors the play_events table / playEvent.add op). */
@Serializable
data class StatsEvent(
    val id: String,
    val trackId: String,
    /** Epoch ms when the session started. */
    val playedAt: Long,
    /** Seconds actually listened during the session. */
    val durationPlayed: Double,
    /** True when >= 90% of the track was heard. */
    val completed: Boolean,
)

/** The metadata stats needs about a track. Lookup may miss (deleted tracks). */
@Serializable
data class StatsTrackMeta(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val genre: String? = null,
)

val UNKNOWN_STATS_TRACK = StatsTrackMeta(
    id = "",
    title = "Unknown Track",
    artist = "Unknown Artist",
    album = "Unknown Album",
    genre = null,
)

data class CalendarParts(val year: Int, val month: Int, val day: Int, val hour: Int)

/**
 * Maps instants to a local calendar. month is 1-12, day 1-31, hour 0-23.
 * [epochAtMidnight] is the inverse: the instant a local calendar day begins.
 */
interface StatsZone {
    fun parts(epochMs: Long): CalendarParts
    fun epochAtMidnight(year: Int, month: Int, day: Int): Long
}

/** Fixed UTC offset zone — what the golden fixtures use. */
fun fixedOffsetZone(offsetMinutes: Int): StatsZone = object : StatsZone {
    private val shift = offsetMinutes * 60_000L

    override fun parts(epochMs: Long): CalendarParts {
        val dt = Instant.ofEpochMilli(epochMs + shift).atOffset(ZoneOffset.UTC)
        return CalendarParts(dt.year, dt.monthValue, dt.dayOfMonth, dt.hour)
    }

    override fun epochAtMidnight(year: Int, month: Int, day: Int): Long =
        LocalDate.of(year, month, day).toEpochDay() * 86_400_000L - shift
}

/** The device's local timezone (DST-correct via java.time). */
fun systemStatsZone(zoneId: ZoneId = ZoneId.systemDefault()): StatsZone = object : StatsZone {
    override fun parts(epochMs: Long): CalendarParts {
        val dt = Instant.ofEpochMilli(epochMs).atZone(zoneId)
        return CalendarParts(dt.year, dt.monthValue, dt.dayOfMonth, dt.hour)
    }

    override fun epochAtMidnight(year: Int, month: Int, day: Int): Long =
        LocalDate.of(year, month, day).atStartOfDay(zoneId).toInstant().toEpochMilli()
}

// ---- small helpers ----------------------------------------------------------

/** NUL separator for composite group keys — can't collide with real names. */
private val GROUP_SEP = Char(0).toString()

private fun pad(n: Int, width: Int): String = n.toString().padStart(width, '0')

/** Days since 1970-01-01 for a local calendar date — adjacency for streaks. */
private fun epochDayOf(year: Int, month: Int, day: Int): Long = LocalDate.of(year, month, day).toEpochDay()

fun dayKeyOf(year: Int, month: Int, day: Int): String = "${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}"

object Stats {

    /** Merge event lists from different sources, keeping the first of each id. */
    fun dedupeEvents(vararg sources: List<StatsEvent>): List<StatsEvent> {
        val seen = HashSet<String>()
        val out = ArrayList<StatsEvent>()
        for (source in sources) {
            for (event in source) {
                if (seen.add(event.id)) out.add(event)
            }
        }
        return out
    }

    /** Events with startMs <= playedAt < endMs (either bound optional). */
    fun filterRange(events: List<StatsEvent>, startMs: Long? = null, endMs: Long? = null): List<StatsEvent> =
        events.filter { (startMs == null || it.playedAt >= startMs) && (endMs == null || it.playedAt < endMs) }

    // ---- range presets ----------------------------------------------------------

    enum class RangePreset(val wireName: String, val label: String) {
        LAST_7_DAYS("last7Days", "Last 7 days"),
        LAST_30_DAYS("last30Days", "Last 30 days"),
        LAST_90_DAYS("last90Days", "Last 90 days"),
        THIS_YEAR("thisYear", "This year"),
        ALL_TIME("allTime", "All time");

        companion object {
            fun fromWireName(name: String): RangePreset = entries.first { it.wireName == name }
        }
    }

    data class Range(val start: Long? = null, val end: Long? = null)

    /**
     * [start, end) instants for a preset. Day presets start at local midnight
     * N-1 days back so "last 7 days" spans 7 calendar days including today.
     */
    fun rangeForPreset(preset: RangePreset, nowMs: Long, zone: StatsZone): Range {
        if (preset == RangePreset.ALL_TIME) return Range()
        val today = zone.parts(nowMs)
        if (preset == RangePreset.THIS_YEAR) return Range(start = zone.epochAtMidnight(today.year, 1, 1))
        val days = when (preset) {
            RangePreset.LAST_7_DAYS -> 7
            RangePreset.LAST_30_DAYS -> 30
            else -> 90
        }
        val startDay = LocalDate.ofEpochDay(epochDayOf(today.year, today.month, today.day) - (days - 1))
        return Range(start = zone.epochAtMidnight(startDay.year, startDay.monthValue, startDay.dayOfMonth))
    }

    // ---- summary ----------------------------------------------------------------

    @Serializable
    data class Summary(
        val plays: Int,
        val completedPlays: Int,
        val listenSeconds: Double,
        val uniqueTracks: Int,
        val uniqueArtists: Int,
        val uniqueAlbums: Int,
    )

    fun summarize(events: List<StatsEvent>, metaById: Map<String, StatsTrackMeta>): Summary {
        val tracks = HashSet<String>()
        val artists = HashSet<String>()
        val albums = HashSet<String>()
        var plays = 0
        var completedPlays = 0
        var listenSeconds = 0.0
        for (event in events) {
            plays += 1
            if (event.completed) completedPlays += 1
            listenSeconds += event.durationPlayed
            tracks.add(event.trackId)
            val meta = metaById[event.trackId] ?: UNKNOWN_STATS_TRACK
            artists.add(meta.artist)
            albums.add("${meta.album}$GROUP_SEP${meta.artist}")
        }
        return Summary(plays, completedPlays, listenSeconds, tracks.size, artists.size, albums.size)
    }

    // ---- rankings ---------------------------------------------------------------

    enum class RankBy { PLAYS, TIME }

    @Serializable
    data class RankedTrack(
        val trackId: String,
        val title: String,
        val artist: String,
        val album: String,
        val plays: Int,
        val listenSeconds: Double,
    )

    @Serializable
    data class RankedGroup(
        /** Artist / album / genre name ("Unknown …" fallbacks for missing meta). */
        val name: String,
        /** For albums: the artist. Empty otherwise. */
        val secondary: String,
        val plays: Int,
        val listenSeconds: Double,
    )

    /**
     * Deterministic ranking: primary metric desc, other metric desc, then
     * name/id asc — ties can't reorder between engines.
     */
    private fun <T> rankedComparator(
        by: RankBy,
        plays: (T) -> Int,
        seconds: (T) -> Double,
        tie: (T) -> String,
    ): Comparator<T> = Comparator { a, b ->
        val primary = if (by == RankBy.PLAYS) plays(b).compareTo(plays(a)) else seconds(b).compareTo(seconds(a))
        if (primary != 0) return@Comparator primary
        val secondary = if (by == RankBy.PLAYS) seconds(b).compareTo(seconds(a)) else plays(b).compareTo(plays(a))
        if (secondary != 0) return@Comparator secondary
        tie(a).compareTo(tie(b))
    }

    fun rankTracks(
        events: List<StatsEvent>,
        metaById: Map<String, StatsTrackMeta>,
        by: RankBy,
        limit: Int,
    ): List<RankedTrack> {
        data class Acc(val meta: StatsTrackMeta, var plays: Int = 0, var seconds: Double = 0.0)

        val acc = LinkedHashMap<String, Acc>()
        for (event in events) {
            val entry = acc.getOrPut(event.trackId) { Acc(metaById[event.trackId] ?: UNKNOWN_STATS_TRACK) }
            entry.plays += 1
            entry.seconds += event.durationPlayed
        }
        return acc.entries
            .map { (trackId, a) -> RankedTrack(trackId, a.meta.title, a.meta.artist, a.meta.album, a.plays, a.seconds) }
            .sortedWith(rankedComparator(by, { it.plays }, { it.listenSeconds }, { it.trackId }))
            .take(maxOf(0, limit))
    }

    enum class GroupField { ARTIST, ALBUM, GENRE }

    fun rankGroups(
        events: List<StatsEvent>,
        metaById: Map<String, StatsTrackMeta>,
        field: GroupField,
        by: RankBy,
        limit: Int,
    ): List<RankedGroup> {
        data class Acc(val name: String, val secondary: String, var plays: Int = 0, var seconds: Double = 0.0)

        val acc = LinkedHashMap<String, Acc>()
        for (event in events) {
            val meta = metaById[event.trackId] ?: UNKNOWN_STATS_TRACK
            val name: String
            var secondary = ""
            when (field) {
                GroupField.ARTIST -> name = meta.artist
                GroupField.ALBUM -> {
                    name = meta.album
                    secondary = meta.artist
                }
                GroupField.GENRE -> name = meta.genre?.takeIf { it.isNotEmpty() } ?: "Unknown Genre"
            }
            val entry = acc.getOrPut("$name$GROUP_SEP$secondary") { Acc(name, secondary) }
            entry.plays += 1
            entry.seconds += event.durationPlayed
        }
        return acc.values
            .map { RankedGroup(it.name, it.secondary, it.plays, it.seconds) }
            .sortedWith(rankedComparator(by, { it.plays }, { it.listenSeconds }, { "${it.name}$GROUP_SEP${it.secondary}" }))
            .take(maxOf(0, limit))
    }

    // ---- calendar buckets (charts + heatmap) --------------------------------------

    @Serializable
    data class Bucket(
        /** "YYYY-MM-DD", "YYYY-MM" or "YYYY" depending on the unit. */
        val key: String,
        val plays: Int,
        val listenSeconds: Double,
    )

    enum class BucketUnit { DAY, MONTH, YEAR }

    /** Buckets sorted by key ascending; empty periods are absent. */
    fun bucketize(events: List<StatsEvent>, zone: StatsZone, unit: BucketUnit): List<Bucket> {
        data class Acc(var plays: Int = 0, var seconds: Double = 0.0)

        val acc = LinkedHashMap<String, Acc>()
        for (event in events) {
            val p = zone.parts(event.playedAt)
            val key = when (unit) {
                BucketUnit.DAY -> dayKeyOf(p.year, p.month, p.day)
                BucketUnit.MONTH -> "${pad(p.year, 4)}-${pad(p.month, 2)}"
                BucketUnit.YEAR -> pad(p.year, 4)
            }
            val entry = acc.getOrPut(key) { Acc() }
            entry.plays += 1
            entry.seconds += event.durationPlayed
        }
        return acc.entries.map { (key, a) -> Bucket(key, a.plays, a.seconds) }.sortedBy { it.key }
    }

    @Serializable
    data class HourSlot(val plays: Int, val listenSeconds: Double)

    /** Listening seconds and plays per hour of day, index 0-23. */
    fun hourHistogram(events: List<StatsEvent>, zone: StatsZone): List<HourSlot> {
        val plays = IntArray(24)
        val seconds = DoubleArray(24)
        for (event in events) {
            val hour = zone.parts(event.playedAt).hour
            plays[hour] += 1
            seconds[hour] += event.durationPlayed
        }
        return (0 until 24).map { HourSlot(plays[it], seconds[it]) }
    }

    // ---- streaks ------------------------------------------------------------------

    @Serializable
    data class Streaks(
        /** Days in the run ending today (or yesterday — today isn't over yet). */
        val current: Int,
        val longest: Int,
        /** First/last day key of the longest run; null when no events. */
        val longestStart: String?,
        val longestEnd: String?,
        /** Total distinct local days with at least one play. */
        val activeDays: Int,
    )

    fun computeStreaks(events: List<StatsEvent>, zone: StatsZone, nowMs: Long): Streaks {
        val days = HashSet<Long>()
        for (event in events) {
            val p = zone.parts(event.playedAt)
            days.add(epochDayOf(p.year, p.month, p.day))
        }
        val sorted = days.sorted()
        fun keyOf(epochDay: Long): String {
            val d = LocalDate.ofEpochDay(epochDay)
            return dayKeyOf(d.year, d.monthValue, d.dayOfMonth)
        }

        var longest = 0
        var longestStart: Long? = null
        var runStart = 0L
        var prev: Long? = null
        for (day in sorted) {
            if (prev == null || day != prev + 1) runStart = day
            prev = day
            val run = (day - runStart + 1).toInt()
            if (run > longest) {
                longest = run
                longestStart = runStart
            }
        }

        val todayParts = zone.parts(nowMs)
        val today = epochDayOf(todayParts.year, todayParts.month, todayParts.day)
        var current = 0
        var cursor: Long? = if (days.contains(today)) today else if (days.contains(today - 1)) today - 1 else null
        while (cursor != null && days.contains(cursor)) {
            current += 1
            cursor -= 1
        }

        return Streaks(
            current = current,
            longest = longest,
            longestStart = longestStart?.let { keyOf(it) },
            longestEnd = longestStart?.let { keyOf(it + longest - 1) },
            activeDays = days.size,
        )
    }

    // ---- yearly recap ("Wrapped") ---------------------------------------------------

    @Serializable
    data class Recap(
        val year: Int,
        val plays: Int,
        val listenSeconds: Double,
        val uniqueTracks: Int,
        val uniqueArtists: Int,
        val uniqueAlbums: Int,
        val activeDays: Int,
        val topTracks: List<RankedTrack>,
        val topArtists: List<RankedGroup>,
        val topAlbums: List<RankedGroup>,
        val topGenres: List<RankedGroup>,
        /** The single biggest listening day of the year. */
        val peakDay: Bucket?,
        val longestStreak: Int,
        /** Hour of day (0-23) with the most listening time; null when no events. */
        val mostActiveHour: Int?,
        /** Listening seconds per month, index 0 = January. */
        val monthlySeconds: List<Double>,
    )

    fun computeRecap(
        events: List<StatsEvent>,
        metaById: Map<String, StatsTrackMeta>,
        zone: StatsZone,
        year: Int,
    ): Recap {
        val start = zone.epochAtMidnight(year, 1, 1)
        val end = zone.epochAtMidnight(year + 1, 1, 1)
        val inYear = filterRange(events, start, end)
        val summary = summarize(inYear, metaById)
        val dayBuckets = bucketize(inYear, zone, BucketUnit.DAY)

        // Buckets are key-ascending, so a strict > keeps the earliest day on ties.
        var peakDay: Bucket? = null
        for (bucket in dayBuckets) {
            if (peakDay == null || bucket.listenSeconds > peakDay.listenSeconds) peakDay = bucket
        }

        val hours = hourHistogram(inYear, zone)
        var mostActiveHour: Int? = null
        for (h in 0 until 24) {
            if (hours[h].listenSeconds > 0 &&
                (mostActiveHour == null || hours[h].listenSeconds > hours[mostActiveHour].listenSeconds)
            ) {
                mostActiveHour = h
            }
        }

        val monthlySeconds = MutableList(12) { 0.0 }
        for (bucket in bucketize(inYear, zone, BucketUnit.MONTH)) {
            monthlySeconds[bucket.key.substring(5, 7).toInt() - 1] = bucket.listenSeconds
        }

        // Streak computation clamped to the year: pass end-of-year as "now" so
        // the current-streak probe stays inside it; only the longest surfaces.
        val streaks = computeStreaks(inYear, zone, end - 1)

        return Recap(
            year = year,
            plays = summary.plays,
            listenSeconds = summary.listenSeconds,
            uniqueTracks = summary.uniqueTracks,
            uniqueArtists = summary.uniqueArtists,
            uniqueAlbums = summary.uniqueAlbums,
            activeDays = streaks.activeDays,
            topTracks = rankTracks(inYear, metaById, RankBy.TIME, 5),
            topArtists = rankGroups(inYear, metaById, GroupField.ARTIST, RankBy.TIME, 5),
            topAlbums = rankGroups(inYear, metaById, GroupField.ALBUM, RankBy.TIME, 5),
            topGenres = rankGroups(inYear, metaById, GroupField.GENRE, RankBy.TIME, 3),
            peakDay = peakDay,
            longestStreak = streaks.longest,
            mostActiveHour = mostActiveHour,
            monthlySeconds = monthlySeconds,
        )
    }

    /** Years (descending) that have at least one event — drives recap pickers. */
    fun recapYears(events: List<StatsEvent>, zone: StatsZone): List<Int> =
        events.map { zone.parts(it.playedAt).year }.distinct().sortedDescending()
}
