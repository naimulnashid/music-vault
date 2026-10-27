package com.musicvault.domain.model

/** Port of the web app's Track (types/index.ts): a vault track; [uri] is its `vault://` media URI. */
data class Track(
    val id: String,
    val uri: String,
    val fileName: String,
    val fileSize: Long,
    val title: String,
    val artist: String,
    val album: String,
    val albumArtist: String? = null,
    val genre: String? = null,
    /** Follows releaseDate. */
    val year: Int? = null,
    val language: String? = null,
    val country: String? = null,
    /** Guest artists, comma-separated. */
    val featuredArtists: String? = null,
    val subgenre: String? = null,
    /** Comma-separated. */
    val secondaryGenres: String? = null,
    /** Comma-separated. */
    val mood: String? = null,
    val vocals: String? = null,
    /** "2019", "2019-05" or "2019-05-14". */
    val releaseDate: String? = null,
    val composer: String? = null,
    val trackNo: Int? = null,
    val discNo: Int? = null,
    val bpm: Double? = null,
    val durationMs: Long = 0L,
    val mimeType: String = "audio/mpeg",
    /** ReplayGain gains in dB, as tagged in the file. */
    val rgTrackGain: Double? = null,
    val rgAlbumGain: Double? = null,
    /** 1–5 stars; 0 = unrated. */
    val rating: Int = 0,
    /** BLAKE3 hash of the file bytes — the track's identity in the vault. */
    val contentHash: String? = null,
    /** Supabase tracks.id. */
    val remoteId: String? = null,
    /** R2 object key of the audio. */
    val storageKey: String? = null,
    /** R2 object key of the online cover. */
    val artworkKey: String? = null,
    val artworkPath: String? = null,
    val lyricsText: String? = null,
    val lyricsLrc: String? = null,
    val addedAt: Long = 0L,
    val favorite: Boolean = false,
)

data class Playlist(
    val id: String,
    val name: String,
    /** Manual playlists only; smart playlists compute their tracks from rules. */
    val trackIds: List<String>,
    val createdAt: Long,
    val isSmart: Boolean = false,
    /** JSON-serialized SmartRules; parsed on demand via SmartRules.parse(). */
    val smartRules: String? = null,
)

enum class RepeatMode { OFF, ONE, ALL }

enum class ThemeMode { DARK, LIGHT }

enum class AccentColor { PURPLE, BLUE, GREEN, PINK }

data class Settings(
    val theme: ThemeMode = ThemeMode.DARK,
    val accent: AccentColor = AccentColor.PURPLE,
    /** Pure-black dark variant for OLED panels (device-local, Phase 6e). */
    val amoled: Boolean = false,
    /** Follow the system light/dark setting (device-local). */
    val followSystemTheme: Boolean = false,
    val eqPreset: String = "Flat",
    val eqBands: List<Float> = Eq.PRESETS.getValue("Flat"),
    val volume: Float = 0.8f,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.OFF,
    val gapless: Boolean = true,
    val crossfadeSeconds: Int = 0,
)

object Eq {
    val FREQS = listOf(31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)

    val PRESETS: Map<String, List<Float>> = linkedMapOf(
        "Flat" to listOf(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f),
        "Bass Boost" to listOf(7f, 6f, 5f, 3f, 1f, 0f, 0f, 0f, 0f, 0f),
        "Vocal" to listOf(-2f, -2f, -1f, 2f, 4f, 4f, 3f, 1f, 0f, -1f),
        "Treble Boost" to listOf(0f, 0f, 0f, 0f, 0f, 1f, 3f, 5f, 6f, 7f),
    )

    const val CUSTOM = "Custom"
    const val MAX_GAIN_DB = 12f
}
