package com.musicvault.domain

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject

/**
 * Kotlin port of the rule-based smart playlist engine in
 * `packages/core/src/smartRules.ts`. The JSON AST is shared across platforms
 * (stored in Room `playlists.smartRules` and later in Supabase), so semantics
 * here must match the TypeScript engine exactly — both are verified against
 * `docs/fixtures/smart-rules.golden.json`. Change them together or not at all.
 */
@Serializable
data class SmartRules(
    val version: Int = 1,
    val root: RuleGroup,
    val sortBy: String? = null,
    val sortDir: String? = null,
    val limit: Int? = null,
) {
    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun parse(text: String): SmartRules? = try {
            json.decodeFromString(serializer(), text)
        } catch (_: Exception) {
            null
        }

        fun empty(): SmartRules = SmartRules(root = RuleGroup())
    }

    fun encode(): String = Json.encodeToString(serializer(), this)
}

@Serializable(with = RuleNodeSerializer::class)
sealed interface RuleNode

@Serializable
data class RuleGroup(
    val combinator: String = "and",
    val rules: List<RuleNode> = emptyList(),
) : RuleNode

@Serializable
data class RuleCondition(
    val field: String,
    val op: String,
    /** String or number in JSON; coerced per op. */
    val value: JsonPrimitive? = null,
    /** Upper bound for `between` (inclusive on both ends). */
    val value2: Double? = null,
) : RuleNode

/** Groups carry a `combinator` key; conditions don't — same shape check as the TS engine. */
object RuleNodeSerializer : JsonContentPolymorphicSerializer<RuleNode>(RuleNode::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out RuleNode> =
        if ("combinator" in element.jsonObject) RuleGroup.serializer() else RuleCondition.serializer()
}

/**
 * Flat, platform-neutral evaluation input (mirrors RuleTrackInput in core):
 * duration in seconds, timestamps in epoch ms.
 */
@Serializable
data class RuleTrackInput(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val genre: String? = null,
    val language: String? = null,
    val country: String? = null,
    val year: Int? = null,
    val duration: Double = 0.0,
    val playCount: Int = 0,
    val addedAt: Long = 0L,
    val lastPlayedAt: Long? = null,
    val favorite: Boolean = false,
)

object SmartRulesEngine {

    private const val MS_PER_DAY = 86_400_000.0

    private enum class FieldType { STRING, NUMBER, DATE, BOOLEAN }

    private val FIELD_TYPES = mapOf(
        "title" to FieldType.STRING,
        "artist" to FieldType.STRING,
        "album" to FieldType.STRING,
        "genre" to FieldType.STRING,
        "language" to FieldType.STRING,
        "country" to FieldType.STRING,
        "year" to FieldType.NUMBER,
        "duration" to FieldType.NUMBER,
        "playCount" to FieldType.NUMBER,
        "addedAt" to FieldType.DATE,
        "lastPlayedAt" to FieldType.DATE,
        "favorite" to FieldType.BOOLEAN,
    )

    private fun stringField(track: RuleTrackInput, field: String): String = when (field) {
        "title" -> track.title
        "artist" -> track.artist
        "album" -> track.album
        "genre" -> track.genre ?: ""
        "language" -> track.language ?: ""
        "country" -> track.country ?: ""
        else -> ""
    }

    private fun numberField(track: RuleTrackInput, field: String): Double? = when (field) {
        "year" -> track.year?.toDouble()
        "duration" -> track.duration
        "playCount" -> track.playCount.toDouble()
        "addedAt" -> track.addedAt.toDouble()
        "lastPlayedAt" -> track.lastPlayedAt?.toDouble()
        else -> null
    }

    private fun numberFieldForCompare(track: RuleTrackInput, field: String): Double? =
        numberField(track, field)

    /** A retired field (album artist, composer, BPM, track/disc number, rating) in a saved rule is never set. */
    private fun isFieldSet(track: RuleTrackInput, field: String): Boolean =
        when (FIELD_TYPES[field]) {
            FieldType.STRING -> stringField(track, field).isNotEmpty()
            FieldType.BOOLEAN -> true
            null -> false
            else -> numberField(track, field) != null
        }

    private fun numericValue(value: JsonPrimitive?): Double = value?.doubleOrNull ?: 0.0

    fun matchesCondition(cond: RuleCondition, track: RuleTrackInput, now: Long): Boolean =
        when (cond.op) {
            "isSet" -> isFieldSet(track, cond.field)
            "notSet" -> !isFieldSet(track, cond.field)
            "isTrue" -> cond.field == "favorite" && track.favorite
            "isFalse" -> cond.field == "favorite" && !track.favorite

            "is", "isNot", "contains", "notContains", "startsWith" -> {
                val field = stringField(track, cond.field).lowercase()
                val value = (cond.value?.content ?: "").lowercase()
                when (cond.op) {
                    "is" -> field == value
                    "isNot" -> field != value
                    "contains" -> field.contains(value)
                    "notContains" -> !field.contains(value)
                    "startsWith" -> field.startsWith(value)
                    else -> false
                }
            }

            "eq", "neq", "gt", "gte", "lt", "lte", "between" -> {
                val field = numberFieldForCompare(track, cond.field)
                if (field == null) false
                else {
                    val value = numericValue(cond.value)
                    when (cond.op) {
                        "eq" -> field == value
                        "neq" -> field != value
                        "gt" -> field > value
                        "gte" -> field >= value
                        "lt" -> field < value
                        "lte" -> field <= value
                        "between" -> field >= value && field <= (cond.value2 ?: value)
                        else -> false
                    }
                }
            }

            "before", "after", "inLast" -> {
                val field = numberField(track, cond.field)
                if (field == null) false
                else {
                    val value = numericValue(cond.value)
                    when (cond.op) {
                        "before" -> field < value
                        "after" -> field > value
                        "inLast" -> field >= now - value * MS_PER_DAY
                        else -> false
                    }
                }
            }

            else -> false
        }

    fun matchesGroup(group: RuleGroup, track: RuleTrackInput, now: Long): Boolean {
        // An empty group matches everything (a freshly created playlist lists all tracks).
        if (group.rules.isEmpty()) return true
        val test: (RuleNode) -> Boolean = { node ->
            when (node) {
                is RuleGroup -> matchesGroup(node, track, now)
                is RuleCondition -> matchesCondition(node, track, now)
            }
        }
        return if (group.combinator == "and") group.rules.all(test) else group.rules.any(test)
    }

    private fun compareForSort(a: RuleTrackInput, b: RuleTrackInput, sortBy: String): Int {
        if (FIELD_TYPES[sortBy] == FieldType.STRING) {
            return stringField(a, sortBy).lowercase().compareTo(stringField(b, sortBy).lowercase())
        }
        val av = numberField(a, sortBy)
        val bv = numberField(b, sortBy)
        // Missing values always sort last, regardless of direction.
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return av.compareTo(bv)
    }

    /**
     * Evaluate a rule set against a library. Returns matching track ids,
     * sorted and limited per the rules (input order preserved when no sortBy).
     */
    fun evaluate(rules: SmartRules, tracks: List<RuleTrackInput>, now: Long): List<String> {
        var matched = tracks.filter { matchesGroup(rules.root, it, now) }

        val sortBy = rules.sortBy
        if (sortBy != null) {
            val dir = if (rules.sortDir == "desc") -1 else 1
            matched = matched.sortedWith(
                Comparator { a, b ->
                    val cmp = compareForSort(a, b, sortBy)
                    if (cmp != 0) {
                        // Missing-last must hold in both directions; ties break by id.
                        val isString = FIELD_TYPES[sortBy] == FieldType.STRING
                        val aMissing = !isString && numberField(a, sortBy) == null
                        val bMissing = !isString && numberField(b, sortBy) == null
                        if (aMissing || bMissing) cmp else cmp * dir
                    } else {
                        a.id.compareTo(b.id)
                    }
                },
            )
        }

        val limit = rules.limit
        if (limit != null && limit >= 0) {
            matched = matched.take(limit)
        }
        return matched.map { it.id }
    }

    /** Map a domain track + play history into the flat evaluation shape. */
    fun toInput(track: com.musicvault.domain.model.Track, playCount: Int, lastPlayedAt: Long?): RuleTrackInput =
        RuleTrackInput(
            id = track.id,
            title = track.title,
            artist = track.artist,
            album = track.album,
            genre = track.genre,
            language = track.language,
            country = track.country,
            year = track.year,
            duration = track.durationMs / 1000.0,
            playCount = playCount,
            addedAt = track.addedAt,
            lastPlayedAt = lastPlayedAt,
            favorite = track.favorite,
        )
}
