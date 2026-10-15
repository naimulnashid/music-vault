package com.musicvault.domain

import com.musicvault.domain.model.Track

/** Port of albums.ts. */
data class Album(
    val key: String,
    val album: String,
    /** The album artist, the one artist on every song, or "Various Artists". */
    val artist: String,
    val tracks: List<Track>,
)

object Albums {
    const val VARIOUS_ARTISTS = "Various Artists"

    private val spaces = Regex("""\s+""")
    private fun norm(s: String) = s.trim().replace(spaces, " ").lowercase()

    /**
     * Identifies the album a song belongs to. Songs of one album often credit
     * different singers, so the track artist is not part of the key: the album
     * title is, plus the album artist when the tags name one. Songs without an
     * album title are grouped per artist.
     */
    fun albumKey(track: Track): String {
        val album = norm(track.album)
        if (album.isEmpty()) return "::${norm(track.artist)}"
        return "$album::${norm(track.albumArtist ?: "")}"
    }

    fun groupAlbums(tracks: List<Track>): List<Album> {
        val map = LinkedHashMap<String, MutableList<Track>>()
        for (track in tracks) {
            map.getOrPut(albumKey(track)) { mutableListOf() }.add(track)
        }
        return map.map { (key, groupTracks) ->
            Album(key = key, album = groupTracks[0].album.trim(), artist = albumArtistOf(groupTracks), tracks = groupTracks)
        }.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.album })
    }

    private fun albumArtistOf(tracks: List<Track>): String {
        tracks.firstNotNullOfOrNull { it.albumArtist?.trim()?.takeIf(String::isNotEmpty) }?.let { return it }
        val artists = tracks.map { it.artist }.toSet()
        return if (artists.size == 1) tracks[0].artist else VARIOUS_ARTISTS
    }
}
