package com.musicvault.domain

import com.google.common.truth.Truth.assertThat
import com.musicvault.domain.model.Track
import org.junit.Test

private fun track(
    id: String,
    title: String = id,
    artist: String = "Artist",
    album: String = "Album",
    genre: String? = null,
    year: Int? = null,
    language: String? = null,
    addedAt: Long = 0,
    favorite: Boolean = false,
) = Track(
    id = id,
    uri = "content://x/$id",
    fileName = "$id.mp3",
    fileSize = 1,
    title = title,
    artist = artist,
    album = album,
    genre = genre,
    year = year,
    language = language,
    addedAt = addedAt,
    favorite = favorite,
)

class SmartPlaylistsTest {

    private val tracks = listOf(
        track("a", addedAt = 3, genre = "Rock", year = 2020),
        track("b", addedAt = 1, favorite = true, year = 1999),
        track("c", addedAt = 2, genre = "Rock"),
        track("d", addedAt = 5, genre = "Pop", language = "eng"),
    )

    @Test
    fun `recently added sorts by addedAt descending`() {
        val result = SmartPlaylists.computeSmartTracks(SmartKey.RECENTLY_ADDED, tracks, HistoryData(emptyList(), emptyMap()))
        assertThat(result.map { it.id }).containsExactly("d", "a", "c", "b").inOrder()
    }

    @Test
    fun `recently played follows history order and skips missing tracks`() {
        val history = HistoryData(recentIds = listOf("c", "zz", "a"), playCounts = emptyMap())
        val result = SmartPlaylists.computeSmartTracks(SmartKey.RECENTLY_PLAYED, tracks, history)
        assertThat(result.map { it.id }).containsExactly("c", "a").inOrder()
    }

    @Test
    fun `most played sorts by count and excludes unplayed`() {
        val history = HistoryData(emptyList(), mapOf("a" to 2, "b" to 7, "c" to 0))
        val result = SmartPlaylists.computeSmartTracks(SmartKey.MOST_PLAYED, tracks, history)
        assertThat(result.map { it.id }).containsExactly("b", "a").inOrder()
    }

    @Test
    fun `favorites filters favorite flag`() {
        val result = SmartPlaylists.computeSmartTracks(SmartKey.FAVORITES, tracks, HistoryData(emptyList(), emptyMap()))
        assertThat(result.map { it.id }).containsExactly("b")
    }

    @Test
    fun `never played excludes tracks with any plays`() {
        val history = HistoryData(emptyList(), mapOf("a" to 1))
        val result = SmartPlaylists.computeSmartTracks(SmartKey.NEVER_PLAYED, tracks, history)
        assertThat(result.map { it.id }).containsExactly("b", "c", "d")
    }

    @Test
    fun `genre groups bucket unknown and sort alphabetically`() {
        val groups = SmartPlaylists.computeSmartGroups(SmartKey.GENRE, tracks)
        assertThat(groups.map { it.name }).containsExactly("Pop", "Rock", "Unknown Genre").inOrder()
        assertThat(groups.first { it.name == "Rock" }.tracks.map { it.id }).containsExactly("a", "c")
    }

    @Test
    fun `year groups sort descending with unknown last`() {
        val groups = SmartPlaylists.computeSmartGroups(SmartKey.YEAR, tracks)
        assertThat(groups.map { it.name }).containsExactly("2020", "1999", "Unknown Year").inOrder()
    }

    @Test
    fun `language groups bucket unknown`() {
        val groups = SmartPlaylists.computeSmartGroups(SmartKey.LANGUAGE, tracks)
        // Case-insensitive alphabetical, matching the web's localeCompare: "eng" < "Unknown Language"
        assertThat(groups.map { it.name }).containsExactly("eng", "Unknown Language").inOrder()
        assertThat(groups.first { it.name == "eng" }.tracks.map { it.id }).containsExactly("d")
    }
}

class AlbumsTest {

    @Test
    fun `songs by different singers stay in one album`() {
        val tracks = listOf(
            track("a", album = "X", artist = "One"),
            track("b", album = "X ", artist = "Two"),
            track("c", album = "Y", artist = "One"),
        )
        val albums = Albums.groupAlbums(tracks)
        assertThat(albums).hasSize(2)
        assertThat(albums.first { it.album == "X" }.tracks.map { it.id }).containsExactly("a", "b")
        assertThat(albums.first { it.album == "X" }.artist).isEqualTo(Albums.VARIOUS_ARTISTS)
        assertThat(albums.first { it.album == "Y" }.artist).isEqualTo("One")
    }

    @Test
    fun `albums sorted by name`() {
        val tracks = listOf(track("a", album = "Zebra"), track("b", album = "Alpha"))
        val albums = Albums.groupAlbums(tracks)
        assertThat(albums.map { it.album }).containsExactly("Alpha", "Zebra").inOrder()
    }
}

class FormatTest {

    @Test
    fun `formatTime renders m colon ss`() {
        assertThat(Format.formatTime(0)).isEqualTo("0:00")
        assertThat(Format.formatTime(65_000)).isEqualTo("1:05")
        assertThat(Format.formatTime(-5)).isEqualTo("0:00")
    }

    @Test
    fun `formatDurationLong picks the right unit pair`() {
        assertThat(Format.formatDurationLong(42)).isEqualTo("42s")
        assertThat(Format.formatDurationLong(36 * 60 + 4)).isEqualTo("36m 4s")
        assertThat(Format.formatDurationLong(2 * 3600 + 14 * 60)).isEqualTo("2h 14m")
    }
}
