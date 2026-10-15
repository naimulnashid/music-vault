package com.musicvault.data.scanner

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.musicvault.data.vault.TrackForm
import dagger.hilt.android.qualifiers.ApplicationContext
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
import timber.log.Timber
import java.io.File
import java.util.logging.Level
import java.util.logging.Logger
import javax.inject.Inject
import javax.inject.Singleton

data class ParsedTags(
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val albumArtist: String? = null,
    val genre: String? = null,
    val year: Int? = null,
    /** The tag's date as a release date ("2019", "2019-05" or "2019-05-14"). */
    val releaseDate: String? = null,
    val language: String? = null,
    val composer: String? = null,
    val trackNo: Int? = null,
    val discNo: Int? = null,
    val bpm: Double? = null,
    val durationMs: Long = 0L,
    val lyricsText: String? = null,
    val artworkBytes: ByteArray? = null,
    val artworkMime: String? = null,
)

/**
 * Port of metadata.ts (music-metadata) tag extraction.
 *
 * JAudioTagger gives full ID3/Vorbis/MP4 access (USLT lyrics, TLAN language) but
 * needs a real java.io.File, so the scanner hands us a temp copy. Anything it
 * can't handle (e.g. raw .aac) falls back to MediaMetadataRetriever on the
 * original content uri, and finally to filename-derived metadata — the same
 * graceful degradation the web app has.
 */
@Singleton
class TagParser @Inject constructor(@ApplicationContext private val context: Context) {

    init {
        // JAudioTagger is chatty on java.util.logging; keep it quiet in production.
        Logger.getLogger("org.jaudiotagger").level = Level.SEVERE
    }

    fun parse(tempFile: File, contentUri: Uri): ParsedTags {
        val fromTagger = parseWithJAudioTagger(tempFile)
        if (fromTagger != null) {
            return if (fromTagger.durationMs > 0) fromTagger
            else fromTagger.copy(durationMs = durationViaRetriever(contentUri))
        }
        return parseWithRetriever(contentUri)
    }

    private fun parseWithJAudioTagger(file: File): ParsedTags? = try {
        val audioFile = AudioFileIO.read(file)
        val tag = audioFile.tag
        val header = audioFile.audioHeader

        fun field(key: FieldKey): String? = try {
            tag?.getFirst(key)?.trim()?.takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        }

        val artwork = try {
            tag?.firstArtwork
        } catch (_: Exception) {
            null
        }

        ParsedTags(
            title = field(FieldKey.TITLE),
            artist = field(FieldKey.ARTIST),
            album = field(FieldKey.ALBUM),
            albumArtist = field(FieldKey.ALBUM_ARTIST),
            genre = field(FieldKey.GENRE),
            year = field(FieldKey.YEAR)?.take(4)?.toIntOrNull(),
            releaseDate = TrackForm.releaseDateFromTag(field(FieldKey.YEAR)),
            language = field(FieldKey.LANGUAGE),
            composer = field(FieldKey.COMPOSER),
            // "3/12"-style values: the number before the slash is the position.
            trackNo = field(FieldKey.TRACK)?.substringBefore('/')?.trim()?.toIntOrNull(),
            discNo = field(FieldKey.DISC_NO)?.substringBefore('/')?.trim()?.toIntOrNull(),
            bpm = field(FieldKey.BPM)?.toDoubleOrNull()?.takeIf { it > 0.0 },
            durationMs = (header?.trackLength ?: 0) * 1000L,
            lyricsText = field(FieldKey.LYRICS),
            artworkBytes = artwork?.binaryData?.takeIf { it.isNotEmpty() },
            artworkMime = artwork?.mimeType,
        )
    } catch (e: Exception) {
        Timber.d(e, "JAudioTagger could not read %s, falling back", file.name)
        null
    }

    private fun parseWithRetriever(uri: Uri): ParsedTags {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            fun meta(key: Int): String? = retriever.extractMetadata(key)?.trim()?.takeIf { it.isNotEmpty() }
            ParsedTags(
                title = meta(MediaMetadataRetriever.METADATA_KEY_TITLE),
                artist = meta(MediaMetadataRetriever.METADATA_KEY_ARTIST),
                album = meta(MediaMetadataRetriever.METADATA_KEY_ALBUM),
                genre = meta(MediaMetadataRetriever.METADATA_KEY_GENRE),
                year = meta(MediaMetadataRetriever.METADATA_KEY_YEAR)?.take(4)?.toIntOrNull(),
                releaseDate = TrackForm.releaseDateFromTag(
                    meta(MediaMetadataRetriever.METADATA_KEY_DATE) ?: meta(MediaMetadataRetriever.METADATA_KEY_YEAR),
                )?.takeUnless { it.startsWith("1904") },
                durationMs = meta(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L,
                artworkBytes = retriever.embeddedPicture,
                artworkMime = null,
            )
        } catch (e: Exception) {
            Timber.w(e, "MediaMetadataRetriever failed for %s", uri)
            ParsedTags()
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
            }
        }
    }

    private fun durationViaRetriever(uri: Uri): Long {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        } catch (_: Exception) {
            0L
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
            }
        }
    }
}
