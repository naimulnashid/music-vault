package com.musicvault.data.vault

import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test

/** Mirrors packages/core/tests/uploadJson.test.ts. */
class UploadJsonTest {

    @Test
    fun `reads one song and joins list values`() {
        val parsed = UploadJson.parse("""{"title":"Song","mood":["Romantic","Yearning"],"release_date":2019,"lyrics":"la la","cover_url":"x"}""")
        assertThat(parsed.songs).containsExactly(
            mapOf("title" to "Song", "mood" to "Romantic, Yearning", "release_date" to "2019", "lyrics_text" to "la la"),
        )
        assertThat(parsed.ignored).containsExactly("cover_url")
    }

    @Test
    fun `understands the research file's names, preferring language over languages`() {
        val parsed = UploadJson.parse(
            """[{"track_title":"A","primary_genre":"Pop","vocal_type":"Female","languages":["Hindi",null],"language":"Hindi"},
                {"track_title":"B","language":null,"languages":["English","Spanish"],"synchronized_lyrics":null}]""",
        )
        assertThat(parsed.songs).containsExactly(
            mapOf("title" to "A", "genre" to "Pop", "vocals" to "Female", "language" to "Hindi"),
            mapOf("title" to "B", "language" to "English, Spanish"),
        ).inOrder()
    }

    @Test
    fun `fills nothing from the template and explains bad input`() {
        assertThrows(UploadJson.Invalid::class.java) { UploadJson.parse(UploadJson.TEMPLATE) }
        assertThrows(UploadJson.Invalid::class.java) { UploadJson.parse("{ title: ") }
        assertThrows(UploadJson.Invalid::class.java) { UploadJson.parse("[1, 2]") }
    }

    @Test
    fun `matches by title, then by file name, each row once`() {
        val rows = listOf(UploadJson.Row("r1", "Chaad Tara", null), UploadJson.Row("r2", "", "Neela.flac"))
        val (matches, unmatched) = UploadJson.match(
            listOf(mapOf("title" to "neela"), mapOf("title" to "Chaad Tara!"), mapOf("title" to "Other")),
            rows,
        )
        assertThat(matches).containsExactly("r2", mapOf("title" to "neela"), "r1", mapOf("title" to "Chaad Tara!"))
        assertThat(unmatched).containsExactly(mapOf("title" to "Other"))
        assertThat(UploadJson.match(listOf(mapOf("title" to "X")), listOf(UploadJson.Row("r1", "Y", null))).first)
            .containsExactly("r1", mapOf("title" to "X"))
    }
}
