package com.musicvault.data.vault

import com.musicvault.data.sync.TrackEdit
import com.musicvault.data.sync.TrackRow
import com.musicvault.domain.Lrc
import com.musicvault.domain.model.Track
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Editor/upload form plumbing for Android — the Kotlin counterpart of
 * normalizeTrackPatch / the field tables in packages/core/src/trackFields.ts
 * and the desktop/web lib/trackForm.ts. Form inputs are strings; patches are
 * JSON objects keyed by Supabase column (what track.edit and the vault take).
 */
object TrackForm {

    /** Editable fields in editor order, with their labels (core EDITABLE_TRACK_FIELDS). */
    val FIELDS: List<Pair<String, String>> = listOf(
        "title" to "Title",
        "artist" to "Artist",
        "featured_artists" to "Featured artists",
        "album" to "Album",
        "genre" to "Genre",
        "subgenre" to "Subgenre",
        "secondary_genres" to "Secondary genres",
        "mood" to "Mood",
        "vocals" to "Vocals",
        "language" to "Language",
        "country" to "Country",
        "release_date" to "Release date",
        "lyrics_text" to "Lyrics",
        "lyrics_synced" to "Synced lyrics (LRC)",
    )

    val UPLOAD_FIELDS = listOf(
        "title", "artist", "featured_artists", "album", "genre", "subgenre", "secondary_genres",
        "mood", "vocals", "language", "country", "release_date",
    )
    val SHARED_FIELDS = listOf("artist", "album", "genre", "subgenre", "secondary_genres", "language", "country", "release_date")
    val PLACEHOLDERS = mapOf("release_date" to "YYYY-MM-DD")
    val MULTILINE = setOf("lyrics_text", "lyrics_synced")

    /** Audio extensions the vault accepts (must equal AUDIO_EXTS in core/upload.ts). */
    val AUDIO_EXTS = setOf("mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "mp4", "aac", "alac", "aiff", "aif", "ape", "wv")

    fun audioExtOf(fileName: String): String? =
        fileName.substringAfterLast('.', "").lowercase().takeIf { it in AUDIO_EXTS }

    class Invalid(message: String) : IllegalArgumentException(message)

    /** A stored release date that is also a real calendar date (core isCalendarDate). */
    private fun isCalendarDate(date: String): Boolean {
        if (!TrackEdit.RELEASE_DATE.matches(date)) return false
        if (date.length < 10) return true
        return runCatching { java.time.LocalDate.parse(date) }.isSuccess
    }

    /**
     * A tag's date ("2019", "2019-05-14", "2019-05-14T10:00:00", "2019/5/4") as
     * a release date, keeping as much as is valid — core releaseDateFromTag.
     */
    fun releaseDateFromTag(raw: String?): String? {
        val m = raw?.let { Regex("^\\s*([0-9]{4})(?:[-/.]([0-9]{1,2})(?:[-/.]([0-9]{1,2}))?)?").find(it) } ?: return null
        val (y, mo, d) = m.destructured
        if (y == "0000") return null
        val full = if (mo.isNotEmpty() && d.isNotEmpty()) "$y-${mo.padStart(2, '0')}-${d.padStart(2, '0')}" else null
        if (full != null && isCalendarDate(full)) return full
        val month = if (mo.isNotEmpty()) "$y-${mo.padStart(2, '0')}" else null
        if (month != null && TrackEdit.RELEASE_DATE.matches(month)) return month
        return y
    }

    /**
     * Turns form strings into a clean patch (only the given [fields]): trims
     * text, blanks → null on optional fields, numbers parsed and range-checked,
     * LRC text → synced lyric lines. Throws [Invalid] for bad input.
     */
    fun normalize(values: Map<String, String>, fields: Iterable<String>): JsonObject = buildJsonObject {
        for (field in fields) {
            val raw = values[field].orEmpty()
            when (field) {
                "title" -> {
                    val title = raw.trim()
                    if (title.isEmpty()) throw Invalid("Title cannot be empty")
                    put(field, title)
                }
                "artist", "album" -> put(field, raw.trim())
                "featured_artists", "genre", "subgenre", "secondary_genres", "mood", "vocals", "language", "country" ->
                    put(field, raw.trim().ifEmpty { null }?.let { JsonPrimitive(it) } ?: JsonNull)
                "lyrics_text" -> put(field, raw.trimEnd().ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
                "release_date" -> {
                    // A trailing hyphen is what the input mask leaves after "2019-".
                    val date = raw.trim().trimEnd('-')
                    if (date.isNotEmpty() && !isCalendarDate(date)) {
                        throw Invalid("Release date must look like 2019, 2019-05 or 2019-05-14")
                    }
                    put(field, date.ifEmpty { null }?.let { JsonPrimitive(it) } ?: JsonNull)
                }
                "lyrics_synced" -> put(field, lrcToJson(raw))
                else -> throw Invalid("Field $field isn't editable")
            }
        }
    }

    /**
     * Keeps a release-date input to digits in the YYYY-MM-DD shape while typing
     * (core maskReleaseDate): non-digits are dropped and a hyphen appears once
     * the year or month is complete. [previous] tells typing from deleting.
     */
    fun maskReleaseDate(previous: String, next: String): String {
        val digits = next.filter { it in '0'..'9' }.take(8)
        val out = StringBuilder(digits.take(4))
        if (digits.length > 4) out.append('-').append(digits.substring(4, minOf(6, digits.length)))
        if (digits.length > 6) out.append('-').append(digits.substring(6))
        if (next.length > previous.length && (digits.length == 4 || digits.length == 6)) out.append('-')
        return out.toString()
    }

    /** LRC text → the `lyrics_synced` JSON array ([{time, text}] in seconds), or null when empty. */
    fun lrcToJson(lrc: String): JsonElement {
        val lines = if (lrc.isBlank()) emptyList() else Lrc.parse(lrc)
        if (lines.isEmpty()) return JsonNull
        return buildJsonArray {
            for (line in lines) {
                add(buildJsonObject {
                    put("time", line.timeMs / 1000.0)
                    put("text", line.text)
                })
            }
        }
    }

    /** `lyrics_synced` JSON → LRC text for the form / Track.lyricsLrc. */
    fun jsonToLrc(json: JsonElement?): String? {
        val array = json as? JsonArray ?: return null
        if (array.isEmpty()) return null
        return array.joinToString("\n") { el ->
            val obj = el.jsonObject
            val time = obj["time"]?.jsonPrimitive?.double ?: 0.0
            val text = obj["text"]?.jsonPrimitive?.content.orEmpty()
            val minutes = (time / 60).toInt()
            val seconds = (time % 60).toInt()
            val centis = ((time % 1) * 100).toInt().coerceIn(0, 99)
            "[%02d:%02d.%02d]%s".format(minutes, seconds, centis, text)
        }
    }

    fun valuesFromTrack(t: Track): Map<String, String> = mapOf(
        "title" to t.title,
        "artist" to t.artist.takeUnless { it == "Unknown Artist" }.orEmpty(),
        "album" to t.album.takeUnless { it == "Unknown Album" }.orEmpty(),
        "featured_artists" to t.featuredArtists.orEmpty(),
        "genre" to t.genre.orEmpty(),
        "subgenre" to t.subgenre.orEmpty(),
        "secondary_genres" to t.secondaryGenres.orEmpty(),
        "mood" to t.mood.orEmpty(),
        "vocals" to t.vocals.orEmpty(),
        "language" to t.language.orEmpty(),
        "country" to t.country.orEmpty(),
        "release_date" to t.releaseDate.orEmpty(),
        "lyrics_text" to t.lyricsText.orEmpty(),
        "lyrics_synced" to t.lyricsLrc.orEmpty(),
    )

    fun valuesFromRow(r: TrackRow): Map<String, String> = mapOf(
        "title" to r.title,
        "artist" to r.artist,
        "album" to r.album,
        "featured_artists" to r.featuredArtists.orEmpty(),
        "genre" to r.genre.orEmpty(),
        "subgenre" to r.subgenre.orEmpty(),
        "secondary_genres" to r.secondaryGenres.orEmpty(),
        "mood" to r.mood.orEmpty(),
        "vocals" to r.vocals.orEmpty(),
        "language" to r.language.orEmpty(),
        "country" to r.country.orEmpty(),
        "release_date" to r.releaseDate.orEmpty(),
        "lyrics_text" to r.lyricsText.orEmpty(),
        "lyrics_synced" to jsonToLrc(r.lyricsSynced).orEmpty(),
    )

    /** The values every track shares; disagreeing fields stay blank. */
    fun commonValues(tracks: List<Track>): Map<String, String> {
        if (tracks.isEmpty()) return emptyMap()
        val all = tracks.map(::valuesFromTrack)
        return FIELDS.associate { (field, _) ->
            val first = all[0][field].orEmpty()
            field to if (all.all { it[field].orEmpty() == first }) first else ""
        }
    }

    /** Whether the patch's shape is queueable (mirrors isValidTrackPatch). */
    fun isQueueable(patch: JsonObject): Boolean = TrackEdit.isValidPatch(patch)
}
