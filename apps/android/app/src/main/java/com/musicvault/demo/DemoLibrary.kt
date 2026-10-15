package com.musicvault.demo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import com.musicvault.data.db.DownloadDao
import com.musicvault.data.db.DownloadEntity
import com.musicvault.data.db.PlayEventDao
import com.musicvault.data.db.PlayEventEntity
import com.musicvault.data.db.PlaylistDao
import com.musicvault.data.db.PlaylistEntity
import com.musicvault.data.db.PlaylistTrackEntity
import com.musicvault.data.db.QueueDao
import com.musicvault.data.prefs.SettingsRepository
import com.musicvault.data.sync.RemoteTrackIndex
import com.musicvault.data.sync.TrackRow
import com.musicvault.domain.RuleCondition
import com.musicvault.domain.RuleGroup
import com.musicvault.domain.SmartRules
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.Calendar
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.floor
import kotlin.math.pow

/**
 * Screenshot demo: an invented library for the README's screenshots, so no
 * real song, cover or listening history is ever published.
 *
 * Only the `demo` build type runs it (BuildConfig.DEMO, no Supabase settings;
 * `node apps/android/scripts/demo-shots.mjs`). It is the web demo
 * (apps/web/src/lib/demo.ts) ported step for step: the same albums, the same
 * seeds and the same order of random draws, so all three apps show one library.
 */
@Singleton
class DemoLibrary @Inject constructor(
    @ApplicationContext private val context: Context,
    private val index: RemoteTrackIndex,
    private val playlistDao: PlaylistDao,
    private val playEventDao: PlayEventDao,
    private val downloadDao: DownloadDao,
    private val queueDao: QueueDao,
    private val settings: SettingsRepository,
) {
    private class DemoAlbum(
        val artist: String,
        val album: String,
        val genre: String,
        val language: String,
        val country: String,
        val releaseDate: String,
        val colors: Pair<String, String>,
        val titles: List<String>,
    )

    private val albums = listOf(
        DemoAlbum("Northbound Lights", "Paper Lanterns", "Indie Pop", "English", "Canada", "2021-04-16", "#f59e0b" to "#db2777", listOf("Paper Lanterns", "Summer in Reverse", "Glass Harbour", "Kite Season", "Small Hours")),
        DemoAlbum("Mira Sol", "Saltwater Hours", "Electronic", "English", "Portugal", "2023-02-03", "#22d3ee" to "#4f46e5", listOf("Saltwater Hours", "Tidal", "Blue Room", "Afterglow Drive", "Coastline", "Static Bloom")),
        DemoAlbum("The Quiet Harbour", "Low Tide Letters", "Folk", "English", "Ireland", "2019-09-27", "#a3e635" to "#0f766e", listOf("Low Tide Letters", "Rowan Street", "Lamplight", "The Long Way Home", "Weathervane")),
        DemoAlbum("Arjo Rahman", "Megher Chithi", "Rock", "Bangla", "Bangladesh", "2020-06-12", "#fb7185" to "#7c2d12", listOf("Megher Chithi", "Nodir Opare", "Shohor", "Brishti Rater Gaan", "Alo")),
        DemoAlbum("Kavya Rao", "Saawan Notes", "Pop", "Hindi", "India", "2022-07-22", "#c084fc" to "#be185d", listOf("Saawan", "Raat Ki Baat", "Khidki", "Chai Aur Baarish", "Safar")),
        DemoAlbum("Lumen Drift", "Glass Orbit", "Ambient", "Instrumental", "Norway", "2024-01-19", "#93c5fd" to "#1e1b4b", listOf("Glass Orbit", "Aurora Field", "Slow Satellite", "Polar Night", "Driftwood")),
        DemoAlbum("Velvet Static", "Night Bus Radio", "Synthwave", "English", "United Kingdom", "2022-11-04", "#f472b6" to "#312e81", listOf("Night Bus Radio", "Neon Rain", "Last Train Out", "Overpass", "Midnight Mile")),
        DemoAlbum("Ana Ferreira", "Casa Azul", "Bossa Nova", "Portuguese", "Brazil", "2018-03-09", "#2dd4bf" to "#1d4ed8", listOf("Casa Azul", "Manhã de Sal", "Varanda", "Samba Lento", "Céu de Abril")),
    )

    /** Park–Miller: the same sequence on every run (and the same as the web demo's). */
    private fun seeded(seed: Long): () -> Double {
        var s = seed
        return {
            s = (s * 16807) % 2147483647
            s.toDouble() / 2147483647
        }
    }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

    /** An abstract square cover: a gradient with soft shapes and rings. */
    private fun drawCover(colors: Pair<String, String>, seed: Long, file: File) {
        val rand = seeded(seed)
        val size = 512f
        val bitmap = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = LinearGradient(0f, 0f, size, size, Color.parseColor(colors.first), Color.parseColor(colors.second), Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, size, size, paint)
        paint.shader = null
        repeat(6) {
            val alpha = 0.08 + rand() * 0.18
            paint.color = if (rand() > 0.5) Color.WHITE else Color.BLACK
            paint.alpha = (alpha * 255).toInt()
            val x = rand() * size
            val y = rand() * size
            canvas.drawCircle(x.toFloat(), y.toFloat(), (40 + rand() * 180).toFloat(), paint)
        }
        paint.style = Paint.Style.STROKE
        paint.color = Color.WHITE
        paint.alpha = (0.35 * 255).toInt()
        paint.strokeWidth = 3f
        val cx = size * (0.3 + rand() * 0.4)
        val cy = size * (0.3 + rand() * 0.4)
        var r = 30.0
        while (r < 260) {
            canvas.drawCircle(cx.toFloat(), cy.toFloat(), r.toFloat(), paint)
            r += 28 + rand() * 20
        }
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        bitmap.recycle()
    }

    /** Silent 8 kHz mono WAV, so a loaded song resolves locally instead of erroring. */
    private fun silentWav(seconds: Double): ByteArray {
        val rate = 8000
        val samples = Math.round(rate * seconds).toInt()
        val buf = java.nio.ByteBuffer.allocate(44 + samples).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        buf.put("RIFF".toByteArray()).putInt(36 + samples).put("WAVEfmt ".toByteArray())
        buf.putInt(16).putShort(1).putShort(1).putInt(rate).putInt(rate).putShort(1).putShort(8)
        buf.put("data".toByteArray()).putInt(samples)
        repeat(samples) { buf.put(128.toByte()) }
        return buf.array()
    }

    /**
     * Loads the demo. Runs before the player restores its last session, so the
     * queue written here is the one it shows.
     */
    suspend fun seed() {
        val rand = seeded(42)
        val now = System.currentTimeMillis()
        val artDir = File(context.filesDir, "artwork").apply { mkdirs() }
        val downloadsDir = File(context.filesDir, "downloads").apply { mkdirs() }

        val rows = mutableListOf<TrackRow>()
        val favorites = HashMap<String, Boolean>()
        val art = HashMap<String, String>()
        albums.forEachIndexed { ai, a ->
            val artHash = sha256("demo-art-$ai")
            val artworkKey = "demo/art/$artHash.jpg"
            val cover = File(artDir, "vault-$artHash.jpg")
            drawCover(a.colors, 1000L + ai * 37, cover)
            art[artworkKey] = cover.absolutePath
            a.titles.forEachIndexed { ti, title ->
                val duration = Math.round(150 + rand() * 180)
                val addedAt = now - (albums.size - ai) * 9L * 86_400_000 - ti * 60_000L
                val id = "demo-$ai-$ti"
                val hash = sha256(id)
                val stamp = Instant.ofEpochMilli(addedAt).toString()
                rows += TrackRow(
                    id = id,
                    userId = "demo",
                    contentHash = hash,
                    fileName = "$title.flac",
                    fileSize = duration * 110_000,
                    title = title,
                    artist = a.artist,
                    album = a.album,
                    genre = a.genre,
                    language = a.language,
                    country = a.country,
                    releaseDate = a.releaseDate,
                    year = a.releaseDate.take(4).toInt(),
                    duration = duration.toDouble(),
                    codec = "FLAC",
                    sampleRate = 44100,
                    storageKey = "demo/audio/$hash.flac",
                    uploadedAt = stamp,
                    artworkKey = artworkKey,
                    createdAt = stamp,
                    updatedAt = stamp,
                )
                if (rand() < 0.25) favorites[id] = true
            }
        }
        val byId = rows.associateBy { it.id }
        fun libraryId(demoId: String) = "vault:" + byId.getValue(demoId).contentHash

        index.set(rows)
        index.setShadowState(emptyList(), favorites, emptyMap())
        index.addArt(art)

        val day = 86_400_000L
        val playlists = listOf(
            PlaylistEntity("demo-pl-1", "Road Trip", now - 40 * day) to listOf("demo-0-1", "demo-6-1", "demo-3-0", "demo-1-3", "demo-7-3", "demo-4-1", "demo-6-4"),
            PlaylistEntity("demo-pl-2", "Late Night Focus", now - 20 * day) to listOf("demo-5-0", "demo-1-2", "demo-5-2", "demo-2-2", "demo-5-3", "demo-7-0"),
            Pair(
                PlaylistEntity(
                    "demo-pl-3",
                    "Bangla",
                    now - 10 * day,
                    isSmart = true,
                    smartRules = SmartRules(
                        root = RuleGroup("and", listOf(RuleCondition("language", "is", JsonPrimitive("Bangla")))),
                    ).encode(),
                ),
                emptyList(),
            ),
        )
        for ((playlist, ids) in playlists) {
            playlistDao.insertPlaylist(playlist)
            playlistDao.insertPlaylistTracks(ids.mapIndexed { i, id -> PlaylistTrackEntity(playlist.id, libraryId(id), i) })
        }

        // A few downloads, so ticks and the Downloads page have something to show.
        val current = byId.getValue("demo-1-0")
        val pinned = listOf("demo-0-0", "demo-0-1", "demo-1-0", "demo-1-3", "demo-3-0", "demo-5-0", "demo-6-1")
        for (id in pinned) {
            val row = byId.getValue(id)
            val file = File(downloadsDir, "vault-${row.contentHash}.wav")
            file.writeBytes(silentWav(if (row === current) row.duration else 1.0))
            downloadDao.upsert(
                DownloadEntity(libraryId(id), row.fileName, row.title, row.artist, row.fileSize, file.absolutePath, now),
            )
        }

        // Six months and a bit of listening, mostly evenings, a little every morning.
        val events = seeded(7)
        for (d in 200 downTo 0) {
            if (events() < 0.35) continue
            val plays = 2 + floor(events() * 12).toInt()
            for (p in 0 until plays) {
                val hour = if (events() < 0.65) 18 + floor(events() * 5).toInt() else 7 + floor(events() * 3).toInt()
                val t = rows[floor(events().pow(1.7) * rows.size).toInt()]
                val heard = t.duration * (0.55 + events() * 0.45)
                val start = Calendar.getInstance().apply {
                    timeInMillis = now - d * day
                    set(Calendar.HOUR_OF_DAY, hour)
                    set(Calendar.MINUTE, floor(events() * 60).toInt())
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                }.timeInMillis
                if (start > now) continue
                playEventDao.add(
                    PlayEventEntity("demo-ev-$d-$p", "vault:${t.contentHash}", start, Math.round(heard).toDouble(), heard >= t.duration * 0.9),
                )
            }
        }

        // Paused 1:14 into the album's first song, as the web demo is.
        val queue = listOf(current.id) + rows.filter { it.album == current.album && it.id != current.id }.map { it.id } + "demo-6-0"
        queueDao.replaceQueue(queue.map { libraryId(it) })
        settings.saveLastPlayback(0, 74_000)
    }
}
