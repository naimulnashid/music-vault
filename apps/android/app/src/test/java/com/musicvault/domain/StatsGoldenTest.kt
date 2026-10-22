package com.musicvault.domain

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Test
import java.io.File

/**
 * Verifies the Kotlin stats engine against the shared golden fixtures in
 * docs/fixtures/stats.golden.json — the same cases the TypeScript engine runs
 * in packages/core/tests/stats.test.ts. If this test and the vitest suite
 * both pass, the two engines agree.
 */
class StatsGoldenTest {

    @Serializable
    private data class GoldenCall(
        val fn: String,
        val preset: String? = null,
        val by: String? = null,
        val limit: Int? = null,
        val field: String? = null,
        val unit: String? = null,
        val year: Int? = null,
    )

    @Serializable
    private data class GoldenCase(val name: String, val call: GoldenCall, val expected: JsonElement? = null)

    @Serializable
    private data class GoldenFile(
        val offsetMinutes: Int,
        val now: Long,
        val tracks: List<StatsTrackMeta>,
        val events: List<StatsEvent>,
        val cases: List<GoldenCase>,
    )

    private fun findFixture(): File {
        // Unit tests run from the module dir (apps/android/app); walk up to the repo root.
        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "docs/fixtures/stats.golden.json")
            if (candidate.exists()) return candidate
            dir = dir.parentFile
        }
        error("stats.golden.json not found above ${File(".").absolutePath}")
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val golden: GoldenFile = json.decodeFromString(GoldenFile.serializer(), findFixture().readText())

    private val zone = fixedOffsetZone(golden.offsetMinutes)
    private val metaById = golden.tracks.associateBy { it.id }

    private fun eventsFor(preset: String?): List<StatsEvent> {
        if (preset == null) return golden.events
        val range = Stats.rangeForPreset(Stats.RangePreset.fromWireName(preset), golden.now, zone)
        return Stats.filterRange(golden.events, range.start, range.end)
    }

    private fun rankBy(name: String) = if (name == "plays") Stats.RankBy.PLAYS else Stats.RankBy.TIME

    /**
     * Runs one fixture call and re-encodes the result to JSON so it can be
     * compared against the fixture's `expected` element. Numeric fields are
     * normalised (3793 vs 3793.0) by decoding `expected` through the same
     * serializers before comparing.
     */
    private fun run(case: GoldenCase): Pair<JsonElement, JsonElement> {
        val call = case.call
        val events = eventsFor(call.preset)
        val expected = case.expected ?: error("${case.name}: fixture case has no expected value")
        return when (call.fn) {
            "summarize" -> {
                val actual = Stats.summarize(events, metaById)
                json.encodeToJsonElement(Stats.Summary.serializer(), actual) to
                    reEncode(expected, Stats.Summary.serializer())
            }
            "rankTracks" -> {
                val actual = Stats.rankTracks(events, metaById, rankBy(call.by!!), call.limit!!)
                json.encodeToJsonElement(RankedTracks, actual) to reEncode(expected, RankedTracks)
            }
            "rankGroups" -> {
                val field = when (call.field!!) {
                    "artist" -> Stats.GroupField.ARTIST
                    "album" -> Stats.GroupField.ALBUM
                    "genre" -> Stats.GroupField.GENRE
                    "year" -> Stats.GroupField.YEAR
                    "language" -> Stats.GroupField.LANGUAGE
                    "country" -> Stats.GroupField.COUNTRY
                    else -> error("unknown field ${call.field}")
                }
                val actual = Stats.rankGroups(events, metaById, field, rankBy(call.by!!), call.limit!!)
                json.encodeToJsonElement(RankedGroups, actual) to reEncode(expected, RankedGroups)
            }
            "rankDevices" -> {
                val actual = Stats.rankDevices(events, rankBy(call.by!!))
                json.encodeToJsonElement(DeviceTimes, actual) to reEncode(expected, DeviceTimes)
            }
            "bucketize" -> {
                val unit = when (call.unit!!) {
                    "day" -> Stats.BucketUnit.DAY
                    "month" -> Stats.BucketUnit.MONTH
                    else -> Stats.BucketUnit.YEAR
                }
                val actual = Stats.bucketize(events, zone, unit)
                json.encodeToJsonElement(Buckets, actual) to reEncode(expected, Buckets)
            }
            "hourHistogram" -> {
                val actual = Stats.hourHistogram(events, zone)
                json.encodeToJsonElement(HourSlots, actual) to reEncode(expected, HourSlots)
            }
            "streaks" -> {
                val actual = Stats.computeStreaks(events, zone, golden.now)
                json.encodeToJsonElement(Stats.Streaks.serializer(), actual) to
                    reEncode(expected, Stats.Streaks.serializer())
            }
            "recap" -> {
                val actual = Stats.computeRecap(events, metaById, zone, call.year!!)
                json.encodeToJsonElement(Stats.Recap.serializer(), actual) to
                    reEncode(expected, Stats.Recap.serializer())
            }
            "recapYears" -> {
                val actual = Stats.recapYears(events, zone)
                json.encodeToJsonElement(Ints, actual) to reEncode(expected, Ints)
            }
            "rangeStart" -> {
                val actual = Stats.rangeForPreset(Stats.RangePreset.fromWireName(call.preset!!), golden.now, zone).start
                json.encodeToJsonElement(LongOrNull, actual) to reEncode(expected, LongOrNull)
            }
            else -> error("unknown fixture fn: ${call.fn}")
        }
    }

    /** Decode + re-encode so numeric representations match the actual side. */
    private fun <T> reEncode(element: JsonElement, serializer: KSerializer<T>): JsonElement =
        json.encodeToJsonElement(serializer, json.decodeFromJsonElement(serializer, element))

    @Test
    fun `all golden cases match the TypeScript engine`() {
        val failures = golden.cases.mapNotNull { case ->
            val (actual, expected) = run(case)
            if (actual != expected) "${case.name}:\n  expected $expected\n  got      $actual" else null
        }
        assertThat(failures).isEmpty()
    }

    @Test
    fun `fixture has meaningful coverage`() {
        assertThat(golden.cases.size).isAtLeast(15)
        assertThat(golden.events.size).isAtLeast(10)
    }

    @Test
    fun `dedupe keeps the first occurrence of each id across sources`() {
        val a = StatsEvent("e1", "t", 0, 10.0, false)
        val b = StatsEvent("e1", "t", 0, 99.0, true)
        val c = StatsEvent("e2", "t", 1, 5.0, false)
        assertThat(Stats.dedupeEvents(listOf(a), listOf(b, c))).containsExactly(a, c).inOrder()
    }

    @Test
    fun `streaks on no events`() {
        val streaks = Stats.computeStreaks(emptyList(), zone, golden.now)
        assertThat(streaks).isEqualTo(Stats.Streaks(0, 0, null, null, 0))
    }

    @Test
    fun `fixed-offset zone splits days at local midnight, not UTC`() {
        // 2026-07-11T18:00Z is exactly local midnight of 2026-07-12 at +06.
        val plus6 = fixedOffsetZone(360)
        assertThat(plus6.parts(1783792799000L).day).isEqualTo(11) // 17:59:59Z
        assertThat(plus6.parts(1783792800000L).day).isEqualTo(12) // 18:00:00Z
        assertThat(plus6.epochAtMidnight(2026, 7, 12)).isEqualTo(1783792800000L)
    }

    private companion object {
        val RankedTracks = ListSerializer(Stats.RankedTrack.serializer())
        val RankedGroups = ListSerializer(Stats.RankedGroup.serializer())
        val DeviceTimes = ListSerializer(Stats.DeviceTime.serializer())
        val Buckets = ListSerializer(Stats.Bucket.serializer())
        val HourSlots = ListSerializer(Stats.HourSlot.serializer())
        val Ints = ListSerializer(Int.serializer())
        val LongOrNull = Long.serializer().nullable
    }
}

class StatsSplitTest {
    @Test
    fun `rankGroups gives a play to each comma-separated artist and genre`() {
        val meta = mapOf("t" to StatsTrackMeta("t", "T", "A, B", "X", genre = "Rock,Pop"))
        val events = listOf(StatsEvent("e", "t", 0, 10.0, true))
        assertThat(Stats.rankGroups(events, meta, Stats.GroupField.ARTIST, Stats.RankBy.TIME, 5).map { it.name })
            .containsExactly("A", "B").inOrder()
        assertThat(Stats.rankGroups(events, meta, Stats.GroupField.GENRE, Stats.RankBy.TIME, 5).map { it.name to it.listenSeconds })
            .containsExactly("Pop" to 10.0, "Rock" to 10.0).inOrder()
    }
}
