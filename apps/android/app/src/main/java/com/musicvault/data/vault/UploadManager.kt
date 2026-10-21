package com.musicvault.data.vault

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import com.musicvault.data.cloud.CloudClient
import com.musicvault.data.scanner.ParsedTags
import com.musicvault.data.scanner.TagParser
import com.musicvault.data.sync.SyncBus
import com.musicvault.data.sync.SyncManager
import com.musicvault.data.sync.SyncOpPayload
import com.musicvault.data.sync.TrackRef
import com.musicvault.data.sync.TrackRow
import com.musicvault.di.ApplicationScope
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.postgrest.from
import io.github.rctcwyvrn.blake3.Blake3
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jaudiotagger.audio.AudioFileIO
import timber.log.Timber
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

enum class UploadStatus { PREPARING, READY, INVALID, QUEUED, UPLOADING, DONE, FAILED }

/** Facts read from the audio itself — shown, never editable. */
data class Technical(
    val durationSec: Double,
    val codec: String?,
    val sampleRate: Int?,
    val bitDepth: Int?,
    val channels: Int?,
)

/** A file the user picked, copied, hashed and read. */
data class PreparedSource(
    val file: File,
    val fileName: String,
    val fileSize: Long,
    val contentHash: String,
    val ext: String,
    val technical: Technical,
    val tags: ParsedTags,
)

/** A cover in the vault's format: square JPEG + 256 px thumb, named by the full image's SHA-256. */
data class PreparedCover(val sha256: String, val full: File, val thumb: File) {
    val fullSize get() = full.length()
    val thumbSize get() = thumb.length()
}

data class UploadItem(
    val id: String,
    val name: String,
    val status: UploadStatus,
    val error: String? = null,
    val source: PreparedSource? = null,
    /** Form values (strings, as typed), keyed by column. */
    val values: Map<String, String> = emptyMap(),
    val cover: PreparedCover? = null,
    /** The online track this file matches (a re-upload keeps its history). */
    val existingTitle: String? = null,
    val stage: String? = null,
    val sent: Long = 0,
    val total: Long = 0,
    val outcome: String? = null,
)

/** Batch cover choice: keep each file's own, one cover for all, or none. */
sealed interface SharedCover {
    data object Keep : SharedCover
    data object None : SharedCover
    data class Set(val cover: PreparedCover) : SharedCover
}

/**
 * Manual uploads to the vault from Android — the Kotlin counterpart of core's
 * upload.ts + desktop/web uploadStore (docs/drive-to-r2-migration.md §2.4).
 * Nothing uploads until the user confirms. Uploads run in the application
 * scope, so they continue while the user browses (and while the process lives).
 */
@Singleton
class UploadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val tagParser: TagParser,
    private val vaultApi: VaultApi,
    private val vaultArtwork: VaultArtwork,
    private val syncManager: SyncManager,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private val staging: File get() = File(context.cacheDir, "upload").apply { mkdirs() }

    private val _items = MutableStateFlow<List<UploadItem>>(emptyList())
    val items: StateFlow<List<UploadItem>> = _items.asStateFlow()

    private val _shared = MutableStateFlow<Map<String, String>>(emptyMap())
    val shared: StateFlow<Map<String, String>> = _shared.asStateFlow()

    private val _sharedCover = MutableStateFlow<SharedCover>(SharedCover.Keep)
    val sharedCover: StateFlow<SharedCover> = _sharedCover.asStateFlow()

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    private fun patch(id: String, f: (UploadItem) -> UploadItem) =
        _items.update { list -> list.map { if (it.id == id) f(it) else it } }

    fun setValue(id: String, field: String, value: String) = patch(id) { it.copy(values = it.values + (field to value)) }

    fun setItemCover(id: String, cover: PreparedCover?) = patch(id) { it.copy(cover = cover) }

    fun setShared(field: String, value: String) = _shared.update { it + (field to value) }

    fun setSharedCover(cover: SharedCover) {
        _sharedCover.value = cover
    }

    fun remove(id: String) = _items.update { list -> list.filter { it.id != id || it.status == UploadStatus.UPLOADING } }

    fun clearFinished() = _items.update { list -> list.filter { it.status != UploadStatus.DONE } }

    // ---- preparing picked files ---------------------------------------------------

    fun addUris(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val placeholders = uris.map { uri -> UploadItem(UUID.randomUUID().toString(), displayName(uri), UploadStatus.PREPARING) }
        _items.update { it + placeholders }
        scope.launch {
            val prepared = uris.zip(placeholders).map { (uri, ph) ->
                async(Dispatchers.IO) { ph.id to runCatching { prepare(uri, ph.name) } }
            }.awaitAll()
            val sources = prepared.mapNotNull { it.second.getOrNull() }
            val existing = runCatching { findExisting(sources) }.getOrDefault(emptyMap())
            val known = _items.value.mapNotNull { it.source?.contentHash }.toMutableSet()
            for ((id, result) in prepared) {
                val source = result.getOrNull()
                if (source == null) {
                    patch(id) { it.copy(status = UploadStatus.INVALID, error = result.exceptionOrNull()?.message ?: "Couldn't read this file") }
                    continue
                }
                val row = existing[source.contentHash]
                when {
                    row != null && row.storageKey != null && row.deletedAt == null ->
                        patch(id) { it.copy(status = UploadStatus.INVALID, error = "Already in your vault as \"${row.title}\"") }
                    !known.add(source.contentHash) ->
                        patch(id) { it.copy(status = UploadStatus.INVALID, error = "This exact file is already in the list") }
                    else -> {
                        val cover = if (row?.artworkKey != null) null else source.tags.artworkBytes?.let { runCatching { prepareCover(it) }.getOrNull() }
                        patch(id) {
                            it.copy(
                                status = UploadStatus.READY,
                                source = source,
                                // A known song starts from its online details; a new one from its tags.
                                values = row?.let(TrackForm::valuesFromRow) ?: valuesFromTags(source),
                                cover = cover,
                                existingTitle = row?.title,
                            )
                        }
                    }
                }
            }
        }
    }

    private fun displayName(uri: Uri): String = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/') ?: "audio"

    private fun prepare(uri: Uri, name: String): PreparedSource {
        val ext = TrackForm.audioExtOf(name) ?: throw IllegalArgumentException("$name isn't a supported audio format")
        val file = File(staging, "${UUID.randomUUID()}.$ext")
        val blake = Blake3.newInstance()
        context.contentResolver.openInputStream(uri)?.use { input ->
            file.outputStream().use { out ->
                val buffer = ByteArray(256 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    blake.update(buffer.copyOfRange(0, n))
                }
            }
        } ?: throw IllegalArgumentException("Couldn't open $name")
        if (file.length() == 0L) throw IllegalArgumentException("$name is empty")
        val tags = tagParser.parse(file, uri)
        val header = runCatching { AudioFileIO.read(file).audioHeader }.getOrNull()
        val technical = Technical(
            durationSec = if (tags.durationMs > 0) tags.durationMs / 1000.0 else (header?.trackLength?.toDouble() ?: 0.0),
            codec = header?.format?.takeIf { it.isNotBlank() } ?: header?.encodingType,
            sampleRate = header?.sampleRateAsNumber,
            bitDepth = header?.bitsPerSample?.takeIf { it > 0 },
            channels = header?.channels?.let { ch -> ch.toIntOrNull() ?: when { ch.contains("stereo", true) -> 2; ch.contains("mono", true) -> 1; else -> null } },
        )
        return PreparedSource(
            file = file,
            fileName = name,
            fileSize = file.length(),
            contentHash = blake.hexdigest(),
            ext = ext,
            technical = technical,
            tags = tags,
        )
    }

    private fun valuesFromTags(s: PreparedSource): Map<String, String> = mapOf(
        "title" to (s.tags.title?.trim()?.ifEmpty { null } ?: s.fileName.substringBeforeLast('.')),
        "artist" to s.tags.artist.orEmpty(),
        "album" to s.tags.album.orEmpty(),
        "genre" to s.tags.genre.orEmpty(),
        "language" to s.tags.language.orEmpty(),
        "release_date" to s.tags.releaseDate.orEmpty(),
    )

    /** Square-crops and resizes an image into the vault's cover format. */
    fun prepareCover(bytes: ByteArray): PreparedCover {
        // Decode no bigger than the cover needs: a phone photo at full size is ~100 MB of
        // bitmap before the crop and scale even start.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val options = BitmapFactory.Options().apply {
            inSampleSize = coverSampleSize(bounds.outWidth, bounds.outHeight, COVER_EDGE)
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: throw IllegalArgumentException("That image couldn't be read — try a JPEG or PNG.")
        val size = minOf(bitmap.width, bitmap.height)
        val square = Bitmap.createBitmap(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size)
        if (square !== bitmap) bitmap.recycle()
        fun jpeg(edge: Int): ByteArray {
            val scaled = if (edge == size) square else Bitmap.createScaledBitmap(square, edge, edge, true)
            return ByteArrayOutputStream().use { out ->
                scaled.compress(Bitmap.CompressFormat.JPEG, 88, out)
                out.toByteArray()
            }.also { if (scaled !== square) scaled.recycle() }
        }
        val full = jpeg(minOf(size, COVER_EDGE))
        val thumb = jpeg(minOf(size, 256))
        square.recycle()
        val sha = MessageDigest.getInstance("SHA-256").digest(full).joinToString("") { "%02x".format(it) }
        val fullFile = File(staging, "$sha.jpg").apply { writeBytes(full) }
        val thumbFile = File(staging, "$sha.thumb.jpg").apply { writeBytes(thumb) }
        return PreparedCover(sha, fullFile, thumbFile)
    }

    fun prepareCover(uri: Uri): PreparedCover {
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalArgumentException("Couldn't open that image")
        return prepareCover(bytes)
    }

    /** Read-only lookup of online rows matching the files (by content hash). */
    private suspend fun findExisting(sources: List<PreparedSource>): Map<String, TrackRow> = withContext(Dispatchers.IO) {
        val client = CloudClient.client ?: return@withContext emptyMap()
        val found = HashMap<String, TrackRow>()
        for (chunk in sources.map { it.contentHash }.chunked(25)) {
            client.from("tracks").select { filter { isIn("content_hash", chunk) } }
                .decodeList<TrackRow>()
                .forEach { row -> row.contentHash?.let { found[it] = row } }
        }
        found
    }

    // ---- uploading ------------------------------------------------------------------

    fun start() {
        if (_running.value) return
        val userId = vaultApi.userId()
        if (userId == null) {
            _items.update { list -> list.map { if (it.status == UploadStatus.READY) it.copy(status = UploadStatus.FAILED, error = "Sign in to upload") else it } }
            return
        }
        val queue = _items.value.filter { (it.status == UploadStatus.READY || it.status == UploadStatus.FAILED) && it.source != null }
        if (queue.isEmpty()) return
        val ids = queue.map { it.id }.toSet()
        _items.update { list -> list.map { if (it.id in ids) it.copy(status = UploadStatus.QUEUED) else it } }
        _running.value = true
        scope.launch {
            val permits = Semaphore(2)
            try {
                queue.map { item ->
                    async { permits.withPermit { runOne(item.id, userId) } }
                }.awaitAll()
            } finally {
                _running.value = false
                syncManager.syncNow() // pull the new rows (with storage keys) into the library
            }
        }
    }

    private suspend fun runOne(id: String, userId: String) {
        val item = _items.value.firstOrNull { it.id == id } ?: return
        val source = item.source ?: return
        patch(id) { it.copy(status = UploadStatus.UPLOADING, error = null, sent = 0, total = source.fileSize) }
        try {
            val outcome = upload(item, source, userId)
            patch(id) { it.copy(status = UploadStatus.DONE, stage = null, outcome = outcome) }
        } catch (e: Exception) {
            Timber.w(e, "upload failed: %s", item.name)
            patch(id) { it.copy(status = UploadStatus.FAILED, stage = null, error = e.message ?: "Upload failed") }
        }
    }

    /** resolve → cover → row → PUT → commit; safe to retry after any failure. Returns the outcome text. */
    private suspend fun upload(item: UploadItem, source: PreparedSource, userId: String): String {
        val client = CloudClient.client ?: throw IllegalStateException("Sign in to upload")
        val sharedFields = TrackForm.SHARED_FIELDS.filter { _shared.value[it].orEmpty().isNotBlank() }
        val values = item.values + sharedFields.associateWith { _shared.value.getValue(it) }
        val cover = when (val s = _sharedCover.value) {
            SharedCover.Keep -> item.cover
            SharedCover.None -> null
            is SharedCover.Set -> s.cover
        }

        patch(item.id) { it.copy(stage = "Checking your library…") }
        val targetId = vaultApi.resolveUploadTarget(source.contentHash)
        val existing = targetId?.let { tid ->
            withContext(Dispatchers.IO) {
                client.from("tracks").select { filter { eq("id", tid) } }.decodeSingleOrNull<TrackRow>()
            }
        }
        if (existing != null && existing.storageKey != null && existing.deletedAt == null) return "Already in your vault"

        var artworkKey: String? = null
        if (cover != null) {
            patch(item.id) { it.copy(stage = "Uploading cover…") }
            val full = vaultApi.signPutArt(cover.sha256, "full", cover.fullSize)
            vaultApi.putFile(full.url, cover.full, "image/jpeg")
            val thumb = vaultApi.signPutArt(cover.sha256, "thumb", cover.thumbSize)
            vaultApi.putFile(thumb.url, cover.thumb, "image/jpeg")
            artworkKey = full.key
        }

        patch(item.id) { it.copy(stage = "Saving details…") }
        val technical = buildJsonObject {
            put("file_size", source.fileSize)
            put("duration", source.technical.durationSec)
            put("codec", source.technical.codec?.let { JsonPrimitive(it) } ?: JsonNull)
            put("sample_rate", source.technical.sampleRate?.let { JsonPrimitive(it) } ?: JsonNull)
            put("bit_depth", source.technical.bitDepth?.let { JsonPrimitive(it) } ?: JsonNull)
            put("channels", source.technical.channels?.let { JsonPrimitive(it) } ?: JsonNull)
        }
        val trackId: String
        var edit: JsonObject? = null
        if (existing != null) {
            trackId = existing.id
            withContext(Dispatchers.IO) {
                client.from("tracks").update(technical) { filter { eq("id", trackId) } }
            }
            // Only what the form changed relative to the online details becomes an edit.
            val online = TrackForm.valuesFromRow(existing)
            val changed = TrackForm.UPLOAD_FIELDS.filter { values[it].orEmpty() != online[it].orEmpty() }
            val extra: Map<String, JsonElement> = if (artworkKey != null) mapOf("artwork_key" to JsonPrimitive(artworkKey)) else emptyMap()
            edit = JsonObject(TrackForm.normalize(values, changed) + extra).takeIf { it.isNotEmpty() }
        } else {
            val fields = TrackForm.normalize(values, TrackForm.UPLOAD_FIELDS)
            val row = buildJsonObject {
                put("user_id", userId)
                put("content_hash", source.contentHash)
                put("file_name", source.fileName)
                technical.forEach { (k, v) -> put(k, v) }
                fields.forEach { (k, v) -> put(k, v) }
                put("artwork_key", artworkKey?.let { JsonPrimitive(it) } ?: JsonNull)
                source.tags.lyricsText?.takeIf { it.isNotBlank() }?.let { put("lyrics_text", it) }
            }
            trackId = withContext(Dispatchers.IO) {
                client.from("tracks").insert(row) { select() }.decodeSingle<TrackRow>().id
            }
        }

        patch(item.id) { it.copy(stage = "Uploading…") }
        val put = vaultApi.signPutAudio(trackId, source.ext)
        vaultApi.putFile(put.url, source.file, VaultApi.audioMime(source.ext)) { sent, total ->
            patch(item.id) { it.copy(sent = sent, total = total) }
        }

        patch(item.id) { it.copy(stage = "Finishing…") }
        vaultApi.commit(trackId, source.ext)
        // The edit goes out only now: a re-uploaded deleted track is a tombstone
        // until the commit revives it, and an edit flushed before would be dropped.
        edit?.let { SyncBus.enqueue(SyncOpPayload.TrackEditOp(TrackRef(remoteId = trackId), it, SyncBus.nowIso())) }
        artworkKey?.let { vaultArtwork.adopt(it, cover!!.full) }
        runCatching { source.file.delete() }
        return if (existing != null) "Uploaded — history kept" else "Uploaded"
    }
}

/** Longest edge a stored cover keeps. */
private const val COVER_EDGE = 1200

/**
 * The largest power-of-two subsample (BitmapFactory's inSampleSize) that still
 * leaves the image's short edge at least [target] px, so the cover loses no detail.
 */
internal fun coverSampleSize(width: Int, height: Int, target: Int): Int {
    var sample = 1
    while (minOf(width, height) / (sample * 2) >= target) sample *= 2
    return sample
}
