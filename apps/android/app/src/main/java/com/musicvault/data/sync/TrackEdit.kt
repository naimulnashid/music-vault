package com.musicvault.data.sync

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.OffsetDateTime

/**
 * Field-level last-writer-wins track metadata edits — 1:1 Kotlin port of
 * `applyTrackEdit` in packages/core/src/trackFields.ts, which mirrors the
 * `public.apply_track_edit` SQL function. All three are pinned by
 * docs/fixtures/track-edit.golden.json (TrackEditGoldenTest); change them
 * in lockstep.
 *
 * Patches are JSON objects keyed by the Supabase column names, so a JSON
 * `null` (clear the field) stays distinct from an absent key (leave it).
 * `year` is not edited directly: writing `release_date` sets it too.
 */
object TrackEdit {

    /** Descriptive fields; everything else on a track is read-only. */
    val EDITABLE: Set<String> = linkedSetOf(
        "title", "artist", "album", "genre", "language", "country", "release_date",
        "lyrics_text", "lyrics_synced", "artwork_key",
    )

    /** "2019", "2019-05" or "2019-05-14" — core RELEASE_DATE and the 0006 column check. */
    val RELEASE_DATE = Regex("^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$")

    /** The year a release date starts with. */
    fun yearOf(releaseDate: String?): Int? =
        releaseDate?.takeIf { RELEASE_DATE.matches(it) }?.take(4)?.toIntOrNull()?.takeIf { it > 0 }

    /** NOT NULL in the schema: a null edit stores "" instead. */
    private val NOT_NULL_TEXT = setOf("artist", "album")

    private val ARTWORK_KEY = Regex("^users/([0-9a-f-]{36})/art/[0-9a-f]{64}\\.jpg$")

    /** A patch apply_track_edit would refuse; [code] matches the TS TrackEditError codes. */
    class Rejected(val code: String, message: String) : IllegalArgumentException(message)

    /** Editable fields only, a non-blank title, a well-formed release date, a cover key under the owner's prefix. */
    fun check(patch: JsonObject, ownerId: String) {
        for (key in patch.keys) {
            if (key !in EDITABLE) throw Rejected("not_editable", "field $key is not editable")
        }
        patch["title"]?.let { title ->
            val ok = title is JsonPrimitive && title.isString && title.content.isNotBlank()
            if (!ok) throw Rejected("empty_title", "title cannot be empty")
        }
        patch["release_date"]?.let { date ->
            if (date is JsonNull) return@let
            val ok = date is JsonPrimitive && date.isString && RELEASE_DATE.matches(date.content)
            if (!ok) throw Rejected("invalid_release_date", "invalid release_date")
        }
        patch["artwork_key"]?.let { key ->
            if (key is JsonNull) return@let
            val match = (key as? JsonPrimitive)?.takeIf { it.isString }?.let { ARTWORK_KEY.matchEntire(it.content) }
            if (match == null || match.groupValues[1] != ownerId) {
                throw Rejected("invalid_artwork_key", "invalid artwork_key")
            }
        }
    }

    /** True when the patch's shape is queueable (ownership aside) — mirrors isValidTrackPatch. */
    fun isValidPatch(patch: JsonObject): Boolean {
        if (patch.isEmpty() || !patch.keys.all { it in EDITABLE }) return false
        patch["title"]?.let { title ->
            if (!(title is JsonPrimitive && title.isString && title.content.isNotBlank())) return false
        }
        val date = patch["release_date"] ?: return true
        return date is JsonNull || (date is JsonPrimitive && date.isString && RELEASE_DATE.matches(date.content))
    }

    /**
     * Applies [patch] with field-level LWW: each field is written only if
     * [editedAt] is at least as new as that field's last edit (ties go to the
     * incoming edit). A rejected patch changes nothing. Timestamps compare as
     * instants, so "+00:00" and "Z" formatting agree.
     */
    fun apply(row: TrackRow, patch: JsonObject, editedAt: String): TrackRow {
        check(patch, row.userId)
        val at = instant(editedAt)
        val clock = row.fieldEditedAt.toMutableMap()
        var out = row
        for ((key, value) in patch) {
            val last = row.fieldEditedAt[key]?.let(::instant)
            if (last != null && last > at) continue
            out = set(out, key, value)
            clock[key] = editedAt
        }
        return out.copy(fieldEditedAt = clock)
    }

    /** Pending local edits (oldest first) overlaid on a pulled row; invalid ones are skipped. */
    fun overlay(row: TrackRow, edits: List<Pair<JsonObject, String>>): TrackRow =
        edits.fold(row) { acc, (patch, editedAt) ->
            try {
                apply(acc, patch, editedAt)
            } catch (_: Rejected) {
                acc
            }
        }

    private fun set(row: TrackRow, key: String, value: JsonElement): TrackRow = when (key) {
        "title" -> row.copy(title = value.jsonPrimitive.content.trim())
        "artist" -> row.copy(artist = value.text() ?: "")
        "album" -> row.copy(album = value.text() ?: "")
        "genre" -> row.copy(genre = value.text())
        "language" -> row.copy(language = value.text())
        "country" -> row.copy(country = value.text())
        "release_date" -> value.text().let { row.copy(releaseDate = it, year = yearOf(it)) }
        "lyrics_text" -> row.copy(lyricsText = value.text())
        "artwork_key" -> row.copy(artworkKey = value.text())
        "lyrics_synced" -> row.copy(lyricsSynced = if (value is JsonNull) null else value)
        else -> row // unreachable: check() rejects unknown keys
    }

    private fun JsonElement.text(): String? = if (this is JsonNull) null else jsonPrimitive.content

    private fun instant(iso: String): Instant = OffsetDateTime.parse(iso).toInstant()
}
