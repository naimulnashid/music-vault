package com.musicvault.data.vault

import com.musicvault.data.sync.TrackEdit
import com.musicvault.data.sync.TrackRow
import com.musicvault.domain.model.Track
import kotlinx.serialization.json.JsonObject
import java.net.URLEncoder
import java.time.Instant
import java.time.OffsetDateTime

/** A track.edit still in the outbox, with every identity key its ref carries. */
data class PendingEdit(val keys: List<String>, val patch: JsonObject, val editedAt: String)

/**
 * The library is the vault — the Kotlin counterpart of desktop's
 * lib/vaultMerge.ts (docs/drive-to-r2-migration.md §2.5): every live track
 * row with audio in the vault becomes a track `vault:<hash>`, its metadata
 * exactly as stored online, with queued edits laid over it so they show
 * before they flush, and favorite/rating from the synced shadow. Tombstones
 * and uploads that never committed don't produce tracks.
 */
object VaultMerge {

    const val VAULT_ID_PREFIX = "vault:"
    const val VAULT_SCHEME = "vault"

    /** Media URI for a vault track: `vault://<hash>?key=<storage key>`. */
    fun vaultUri(contentHash: String, storageKey: String): String =
        "$VAULT_SCHEME://$contentHash?key=${URLEncoder.encode(storageKey, "UTF-8")}"

    fun isCloudUri(uri: String) = uri.startsWith("$VAULT_SCHEME://")

    private fun rowKeys(r: TrackRow) = buildList {
        add("remote:${r.id}")
        r.contentHash?.let { add("hash:$it") }
    }

    fun merge(
        rows: List<TrackRow>,
        pending: List<PendingEdit>,
        favorites: Map<String, Boolean>,
        ratings: Map<String, Int>,
        art: Map<String, String>,
    ): List<Track> {
        val editsByKey = HashMap<String, MutableList<PendingEdit>>()
        for (e in pending) for (k in e.keys) editsByKey.getOrPut(k) { mutableListOf() }.add(e)

        return rows.mapNotNull { row ->
            if (row.deletedAt != null || row.storageKey == null || row.contentHash == null) return@mapNotNull null
            val edits = rowKeys(row).flatMap { editsByKey[it].orEmpty() }.distinct().sortedBy { it.editedAt }
            val eff = if (edits.isEmpty()) row else TrackEdit.overlay(row, edits.map { it.patch to it.editedAt })
            vaultTrack(eff, art).copy(
                favorite = favorites[row.id] ?: false,
                rating = ratings[row.id] ?: 0,
            )
        }
    }

    fun vaultTrack(r: TrackRow, art: Map<String, String>): Track {
        val stamp = r.uploadedAt ?: r.createdAt
        val added = runCatching { OffsetDateTime.parse(stamp).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(stamp).toEpochMilli() }
            .getOrDefault(0L)
        return Track(
            id = VAULT_ID_PREFIX + r.contentHash,
            uri = vaultUri(r.contentHash!!, r.storageKey!!),
            fileName = r.fileName,
            fileSize = r.fileSize,
            title = r.title,
            artist = r.artist.ifEmpty { "Unknown Artist" },
            album = r.album.ifEmpty { "Unknown Album" },
            albumArtist = r.albumArtist,
            genre = r.genre,
            year = TrackEdit.yearOf(r.releaseDate) ?: r.year,
            language = r.language,
            country = r.country,
            releaseDate = r.releaseDate,
            composer = r.composer,
            trackNo = r.trackNo,
            discNo = r.discNo,
            bpm = r.bpm,
            durationMs = (r.duration * 1000).toLong(),
            mimeType = VaultApi.audioMime(r.storageKey.substringAfterLast('.')),
            rgTrackGain = r.replaygainTrackDb,
            rgAlbumGain = r.replaygainAlbumDb,
            contentHash = r.contentHash,
            remoteId = r.id,
            storageKey = r.storageKey,
            artworkKey = r.artworkKey,
            artworkPath = r.artworkKey?.let { art[it] },
            lyricsText = r.lyricsText,
            lyricsLrc = TrackForm.jsonToLrc(r.lyricsSynced),
            addedAt = added,
        )
    }

    /** `vault-<sha>.jpg`, the cached file name for an online cover key. */
    fun artFileName(artworkKey: String): String? =
        Regex("/art/([0-9a-f]{64})\\.jpg$").find(artworkKey)?.groupValues?.get(1)?.let { "vault-$it.jpg" }
}
