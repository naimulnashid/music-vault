package com.musicvault.data.vault

import com.google.common.truth.Truth.assertThat
import com.musicvault.data.sync.TrackRow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultMergeTest {

    private val h1 = "1".repeat(64)
    private val h2 = "2".repeat(64)

    private fun row(
        id: String = "r1",
        hash: String? = h1,
        title: String = "Online Title",
        genre: String? = null,
        edited: Map<String, String> = emptyMap(),
        storageKey: String? = null,
        deletedAt: String? = null,
    ) = TrackRow(
        id = id,
        contentHash = hash,
        fileName = "song.flac",
        fileSize = 100,
        title = title,
        artist = "Online Artist",
        album = "Online Album",
        genre = genre,
        duration = 200.0,
        storageKey = storageKey,
        fieldEditedAt = edited,
        deletedAt = deletedAt,
        createdAt = "2026-10-01T00:00:00+00:00",
    )

    private fun audio(h: String, ext: String = "flac") = "users/u/audio/$h.$ext"

    private fun merge(
        rows: List<TrackRow>,
        pending: List<PendingEdit> = emptyList(),
        favorites: Map<String, Boolean> = emptyMap(),
        ratings: Map<String, Int> = emptyMap(),
    ) = VaultMerge.merge(rows, pending, favorites, ratings, emptyMap())

    @Test
    fun `live rows with vault audio become tracks, the rest never show`() {
        val out = merge(
            listOf(
                row(id = "v", hash = h1, storageKey = audio(h1, "mp3"), genre = "Folk"),
                row(id = "gone", hash = h2, deletedAt = "2026-10-11T00:00:00Z"),
                row(id = "unfinished", hash = "3".repeat(64)), // upload never committed
            ),
            favorites = mapOf("v" to true),
            ratings = mapOf("v" to 4),
        )
        val vault = out.single()
        assertThat(vault.id).isEqualTo("vault:$h1")
        assertThat(vault.uri).startsWith("vault://$h1?key=")
        assertThat(vault.remoteId).isEqualTo("v")
        assertThat(vault.genre).isEqualTo("Folk")
        assertThat(vault.mimeType).isEqualTo("audio/mpeg")
        assertThat(vault.favorite).isTrue()
        assertThat(vault.rating).isEqualTo(4)
    }

    @Test
    fun `queued edits show before they flush, newest server edit still wins`() {
        val pending = listOf(
            PendingEdit(listOf("hash:$h1"), JsonObject(mapOf("title" to JsonPrimitive("Queued"))), "2026-10-11T12:00:00Z"),
            PendingEdit(listOf("remote:r3"), JsonObject(mapOf("title" to JsonPrimitive("Stale"))), "2026-10-01T00:00:00Z"),
        )
        val out = merge(
            listOf(
                row(storageKey = audio(h1)),
                row(id = "r3", hash = h2, storageKey = audio(h2), title = "Server", edited = mapOf("title" to "2026-10-11T00:00:00Z")),
            ),
            pending,
        )
        assertThat(out[0].title).isEqualTo("Queued")
        assertThat(out[1].title).isEqualTo("Server")
    }

    @Test
    fun `cover keys map to cached file names`() {
        assertThat(VaultMerge.artFileName("users/u/art/${"c".repeat(64)}.jpg")).isEqualTo("vault-${"c".repeat(64)}.jpg")
        assertThat(VaultMerge.artFileName("nope")).isNull()
    }

    @Test
    fun `only hashes with no live row count as deleted`() {
        val gone = DownloadRepository.deletedHashes(
            listOf(
                row(id = "a", hash = h1, deletedAt = "2026-10-11T00:00:00Z"),
                row(id = "b", hash = h2, deletedAt = "2026-10-11T00:00:00Z"),
                row(id = "c", hash = h2, storageKey = audio(h2, "mp3")), // re-uploaded elsewhere
            ),
        )
        assertThat(gone).containsExactly(h1)
    }

    // ---- TrackForm ----------------------------------------------------------------

    @Test
    fun `form normalization trims, nulls blanks, checks release dates and rejects bad input`() {
        val patch = TrackForm.normalize(
            mapOf("title" to "  Song ", "artist" to " A ", "genre" to "  ", "release_date" to " 1999-05 ", "country" to ""),
            listOf("title", "artist", "genre", "release_date", "country"),
        )
        assertThat(patch["title"]).isEqualTo(JsonPrimitive("Song"))
        assertThat(patch["artist"]).isEqualTo(JsonPrimitive("A"))
        assertThat(patch["genre"].toString()).isEqualTo("null")
        assertThat(patch["release_date"]).isEqualTo(JsonPrimitive("1999-05"))
        assertThat(patch["country"].toString()).isEqualTo("null")
        assertThat(TrackForm.normalize(mapOf("release_date" to "2024-02-29"), listOf("release_date"))["release_date"])
            .isEqualTo(JsonPrimitive("2024-02-29"))
        assertThrows(TrackForm.Invalid::class.java) { TrackForm.normalize(mapOf("title" to " "), listOf("title")) }
        for (bad in listOf("19x9", "1999-13", "2023-02-29", "1999/05/14")) {
            assertThrows(TrackForm.Invalid::class.java) { TrackForm.normalize(mapOf("release_date" to bad), listOf("release_date")) }
        }
        assertThrows(TrackForm.Invalid::class.java) { TrackForm.normalize(mapOf("year" to "1999"), listOf("year")) }
        assertThrows(TrackForm.Invalid::class.java) { TrackForm.normalize(mapOf("duration" to "1"), listOf("duration")) }
    }

    @Test
    fun `release dates are read from tags like core releaseDateFromTag`() {
        assertThat(TrackForm.releaseDateFromTag("2019")).isEqualTo("2019")
        assertThat(TrackForm.releaseDateFromTag("2019-05-14T10:00:00")).isEqualTo("2019-05-14")
        assertThat(TrackForm.releaseDateFromTag("2019/5/4")).isEqualTo("2019-05-04")
        assertThat(TrackForm.releaseDateFromTag("2019-02-30")).isEqualTo("2019-02")
        assertThat(TrackForm.releaseDateFromTag("2019-13-01")).isEqualTo("2019")
        assertThat(TrackForm.releaseDateFromTag("0000")).isNull()
        assertThat(TrackForm.releaseDateFromTag("May 2019")).isNull()
    }

    @Test
    fun `synced lyrics round-trip between LRC text and JSON`() {
        val json = TrackForm.lrcToJson("[00:01.50]first\n[01:02.00]second")
        val lrc = TrackForm.jsonToLrc(json)
        assertThat(lrc).isEqualTo("[00:01.50]first\n[01:02.00]second")
        assertThat(TrackForm.lrcToJson("  ").toString()).isEqualTo("null")
        assertThat(TrackForm.audioExtOf("Song.FLAC")).isEqualTo("flac")
        assertThat(TrackForm.audioExtOf("notes.txt")).isNull()
    }
}
