package com.musicvault.data.vault

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.Normalizer

/**
 * Song details pasted as JSON into the upload screen: a port of core
 * uploadJson.ts (docs/upload-json.md). One song is an object, several an
 * array; list values become "A, B"; missing, null or empty values leave a
 * field as it is. The research file's names are understood too.
 */
object UploadJson {

    class Invalid(message: String) : Exception(message)

    data class Parsed(val songs: List<Map<String, String>>, val ignored: List<String>)

    /** JSON key → form field. When two keys fill one field, the earlier one here wins. */
    private val KEYS = listOf(
        "title" to "title",
        "track_title" to "title",
        "artist" to "artist",
        "featured_artists" to "featured_artists",
        "album" to "album",
        "genre" to "genre",
        "primary_genre" to "genre",
        "subgenre" to "subgenre",
        "secondary_genres" to "secondary_genres",
        "mood" to "mood",
        "vocals" to "vocals",
        "vocal_type" to "vocals",
        "language" to "language",
        "languages" to "language",
        "country" to "country",
        "release_date" to "release_date",
        "lyrics" to "lyrics_text",
        "lyrics_text" to "lyrics_text",
        "plain_lyrics" to "lyrics_text",
        "synced_lyrics" to "lyrics_synced",
        "lyrics_synced" to "lyrics_synced",
        "synchronized_lyrics" to "lyrics_synced",
    )
    private val KNOWN = KEYS.map { it.first }.toSet()

    /** The template's placeholders (core UPLOAD_JSON_TEMPLATE), so pasting it unchanged fills nothing. */
    private val PLACEHOLDERS = setOf("YYYY-MM-DD", "[00:12.00] First line\n[00:15.50] Second line")

    private fun text(value: JsonElement?): String? = when (value) {
        null, JsonNull -> null
        is JsonPrimitive -> if (value.isString) {
            value.content.trim().ifEmpty { null }
        } else {
            value.doubleOrNull?.let { d -> if (d == Math.floor(d)) d.toLong().toString() else d.toString() }
        }
        is JsonArray -> value.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.contentOrNull?.trim()?.ifEmpty { null } }
            .distinct().joinToString(", ").ifEmpty { null }
        else -> null
    }

    fun parse(raw: String): Parsed {
        val data = try {
            Json.parseToJsonElement(raw)
        } catch (e: Exception) {
            throw Invalid("That isn't valid JSON. Paste one song as { … } or several as [ { … }, { … } ].")
        }
        val list = if (data is JsonArray) data.toList() else listOf(data)
        if (list.isEmpty() || list.any { it !is JsonObject }) throw Invalid("Paste one song as { … } or several as [ { … }, { … } ].")
        val ignored = sortedSetOf<String>()
        val songs = list.map { element ->
            val obj = element as JsonObject
            obj.keys.filterNot { it in KNOWN }.forEach { ignored += it }
            val out = LinkedHashMap<String, String>()
            for ((key, field) in KEYS) {
                if (field in out || key !in obj) continue
                val value = text(obj[key])
                if (value != null && value !in PLACEHOLDERS) out[field] = value
            }
            out as Map<String, String>
        }
        if (songs.all { it.isEmpty() }) throw Invalid("Nothing to fill: none of the pasted keys is a song detail. See the template.")
        return Parsed(songs, ignored.toList())
    }

    private fun norm(s: String?): String =
        Normalizer.normalize(s.orEmpty(), Normalizer.Form.NFKD).replace(Regex("\\p{M}+"), "")
            .lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()

    data class Row(val id: String, val title: String?, val fileName: String?)

    /** Pairs songs with rows by title, else file name; one song and one row pair up whatever their titles. */
    fun match(songs: List<Map<String, String>>, rows: List<Row>): Pair<Map<String, Map<String, String>>, List<Map<String, String>>> {
        if (songs.size == 1 && rows.size == 1) return mapOf(rows[0].id to songs[0]) to emptyList()
        val free = rows.associateBy { it.id }.toMutableMap()
        val matches = LinkedHashMap<String, Map<String, String>>()
        val unmatched = ArrayList<Map<String, String>>()
        for (song in songs) {
            val title = norm(song["title"])
            val row = if (title.isEmpty()) null else
                free.values.firstOrNull { norm(it.title) == title }
                    ?: free.values.firstOrNull { norm(it.fileName?.substringBeforeLast('.')) == title }
            if (row != null) {
                free.remove(row.id)
                matches[row.id] = song
            } else {
                unmatched += song
            }
        }
        return matches to unmatched
    }

    /** The template, as the upload screen offers it to copy. */
    const val TEMPLATE = """{
  "title": "",
  "artist": "",
  "featured_artists": "",
  "album": "",
  "genre": "",
  "subgenre": "",
  "secondary_genres": "",
  "mood": "",
  "vocals": "",
  "language": "",
  "country": "",
  "release_date": "YYYY-MM-DD",
  "lyrics": "",
  "synced_lyrics": "[00:12.00] First line\n[00:15.50] Second line"
}"""
}
