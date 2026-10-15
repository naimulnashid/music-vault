package com.musicvault.data.vault

import android.content.Context
import androidx.media3.common.C
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.CacheSpan
import androidx.media3.datasource.cache.SimpleCache
import com.musicvault.data.db.DownloadDao
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import java.util.TreeSet
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The two-tier audio cache (docs/architecture.md):
 *
 * 1. **Auto-cache** — Media3 [SimpleCache] under filesDir/audio-cache.
 *    Playback streams *through* it (progressive download-then-play: a track
 *    is fetched from the vault at most once), LRU-evicted under a cap of
 *    0–10 GiB. At 0, or with auto-download on, playback streams without it.
 * 2. **Pinned downloads** — whole files under filesDir/downloads, tracked in
 *    the Room `downloads` table by track id `vault:<hash>` (file
 *    `vault-<hash>.<ext>`), permanent until the user removes them.
 *
 * Play resolution order (VaultDataSource): pinned download → auto-cache/stream.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Singleton
class AudioCache @Inject constructor(
    @ApplicationContext private val context: Context,
    private val downloadDao: DownloadDao,
) {
    private val prefs = context.getSharedPreferences("mv_cache", Context.MODE_PRIVATE)

    val downloadsDir: File = File(context.filesDir, "downloads")

    private val _maxCacheBytes = MutableStateFlow(prefs.getLong(KEY_MAX_BYTES, DEFAULT_MAX_BYTES).coerceIn(0, MAX_MAX_BYTES))
    val maxCacheBytesFlow: StateFlow<Long> = _maxCacheBytes.asStateFlow()

    /** The auto-cache cap; 0 turns it off. Lowering it evicts right away (call from a coroutine). */
    val maxCacheBytes: Long get() = _maxCacheBytes.value

    suspend fun setMaxCacheBytes(value: Long) {
        val capped = value.coerceIn(0, MAX_MAX_BYTES)
        prefs.edit().putLong(KEY_MAX_BYTES, capped).apply()
        _maxCacheBytes.value = capped
        trimTo(capped)
    }

    private val _autoDownload = MutableStateFlow(prefs.getBoolean(KEY_AUTO_DOWNLOAD, false))

    /** Keep every vault song as a download; the auto-cache isn't used meanwhile. */
    val autoDownloadFlow: StateFlow<Boolean> = _autoDownload.asStateFlow()
    val autoDownload: Boolean get() = _autoDownload.value

    suspend fun setAutoDownload(on: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_DOWNLOAD, on).apply()
        _autoDownload.value = on
        if (on) clearAutoCache()
    }

    /** Whether playback should stream through the auto-cache right now. */
    val cacheEnabled: Boolean get() = maxCacheBytes > 0 && !autoDownload

    /** The streaming auto-cache (tier 1). One instance per process. */
    val simpleCache: Cache by lazy {
        SimpleCache(
            File(context.filesDir, "audio-cache"),
            LiveCapLruEvictor { maxCacheBytes },
            StandaloneDatabaseProvider(context),
        )
    }

    /** Track ids (`vault:<hash>`) with a pinned download, for badges and menu state. */
    val pinnedFileIds: Flow<Set<String>> = downloadDao.observeFileIds().map { it.toSet() }

    /** The pinned copy of a vault track (`vault-<hash>.<ext>`), or null. Synchronous file check only. */
    fun pinnedVaultFile(contentHash: String): File? {
        val stem = vaultFileStem(contentHash)
        val candidates = downloadsDir.listFiles { f -> f.nameWithoutExtension == stem } ?: return null
        return candidates.firstOrNull { it.isFile && it.length() > 0 }
    }

    /** Target file for a pinned vault download. */
    fun vaultDownloadTarget(contentHash: String, ext: String): File =
        File(downloadsDir, "${vaultFileStem(contentHash)}.${ext.ifEmpty { "bin" }}")

    suspend fun removeDownload(trackId: String) {
        downloadDao.get(trackId)?.let { File(it.path).delete() }
        pinnedVaultFile(trackId.removePrefix("vault:"))?.delete()
        downloadDao.delete(trackId)
        Timber.i("Removed pinned download %s", trackId)
    }

    suspend fun cacheUsageBytes(): Long = withContext(Dispatchers.IO) { simpleCache.cacheSpace }

    /** Empties the auto-cache. Pinned downloads are a separate tier and stay. */
    suspend fun clearAutoCache() = withContext(Dispatchers.IO) {
        simpleCache.keys.toList().forEach { simpleCache.removeResource(it) }
        Timber.i("Auto-cache cleared")
    }

    /** Evicts least recently used spans until the cache fits [max]. */
    private suspend fun trimTo(max: Long) = withContext(Dispatchers.IO) {
        if (simpleCache.cacheSpace <= max) return@withContext
        val spans = simpleCache.keys.flatMap { simpleCache.getCachedSpans(it) }.sortedBy { it.lastTouchTimestamp }
        for (span in spans) {
            if (simpleCache.cacheSpace <= max) break
            simpleCache.removeSpan(span)
        }
    }

    companion object {
        /** `downloads` key of a pinned vault track — its library id. */
        fun vaultKey(contentHash: String) = "vault:$contentHash"

        private fun vaultFileStem(contentHash: String) = "vault-$contentHash"

        private const val KEY_MAX_BYTES = "maxCacheBytes"
        private const val KEY_AUTO_DOWNLOAD = "autoDownload"

        /** 2 GiB default on phones; 10 GiB is the most any client allows. */
        private const val DEFAULT_MAX_BYTES = 2L * 1024 * 1024 * 1024
        const val MAX_MAX_BYTES = 10L * 1024 * 1024 * 1024
    }
}

/**
 * Media3's LeastRecentlyUsedCacheEvictor with a cap read on every eviction,
 * so a new limit applies without restarting the app.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
private class LiveCapLruEvictor(private val maxBytes: () -> Long) : CacheEvictor {
    private val spans = TreeSet<CacheSpan> { a, b ->
        val byTime = a.lastTouchTimestamp.compareTo(b.lastTouchTimestamp)
        if (byTime != 0) byTime else a.compareTo(b)
    }
    private var currentSize = 0L

    override fun requiresCacheSpanTouches() = true

    override fun onCacheInitialized() = Unit

    override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) {
        if (length != C.LENGTH_UNSET.toLong()) evict(cache, length)
    }

    override fun onSpanAdded(cache: Cache, span: CacheSpan) {
        spans.add(span)
        currentSize += span.length
        evict(cache, 0)
    }

    override fun onSpanRemoved(cache: Cache, span: CacheSpan) {
        spans.remove(span)
        currentSize -= span.length
    }

    override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) {
        onSpanRemoved(cache, oldSpan)
        onSpanAdded(cache, newSpan)
    }

    private fun evict(cache: Cache, required: Long) {
        while (currentSize + required > maxBytes() && spans.isNotEmpty()) {
            cache.removeSpan(spans.first())
        }
    }
}
