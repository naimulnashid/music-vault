package com.musicvault.data.vault

import android.content.Context
import com.musicvault.data.sync.RemoteTrackIndex
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Online covers on Android: downloads each artwork key's full image (and
 * thumbnail) once into filesDir/artwork as `vault-<sha>.jpg`, then publishes
 * key → path to [RemoteTrackIndex] so the library shows it. Covers are
 * content-addressed, so a cached file is always current.
 */
@Singleton
class VaultArtwork @Inject constructor(
    @ApplicationContext private val context: Context,
    private val vaultApi: VaultApi,
    private val index: RemoteTrackIndex,
) {
    private val dir: File by lazy { File(context.filesDir, "artwork").apply { mkdirs() } }
    private val mutex = Mutex()

    /** Makes sure every cover the rows reference is cached; safe to call often. */
    suspend fun sync() = mutex.withLock {
        val keys = index.tracks.value.filter { it.deletedAt == null }.mapNotNull { it.artworkKey }.distinct()
        val known = index.art.value
        val found = HashMap<String, String>()
        val missing = mutableListOf<String>()
        for (key in keys) {
            if (key in known) continue
            val name = VaultMerge.artFileName(key) ?: continue
            val file = File(dir, name)
            if (file.exists()) found[key] = file.absolutePath else missing += key
        }
        if (missing.isNotEmpty() && vaultApi.userId() != null) {
            try {
                val urls = vaultApi.signGet(missing)
                for (key in missing) {
                    val url = urls[key] ?: continue
                    val file = File(dir, VaultMerge.artFileName(key)!!)
                    withContext(Dispatchers.IO) {
                        val bytes = vaultApi.download(url)
                        val temp = File(dir, file.name + ".part")
                        temp.writeBytes(bytes)
                        temp.renameTo(file)
                    }
                    found[key] = file.absolutePath
                }
            } catch (e: Exception) {
                Timber.w(e, "online cover download failed")
            }
        }
        if (found.isNotEmpty()) index.addArt(found)
    }

    /** Stores a cover this device just uploaded, so it shows without downloading it back. */
    fun adopt(artworkKey: String, full: File) {
        val name = VaultMerge.artFileName(artworkKey) ?: return
        val target = File(dir, name)
        runCatching { full.copyTo(target, overwrite = true) }
            .onSuccess { index.addArt(mapOf(artworkKey to target.absolutePath)) }
            .onFailure { Timber.w(it, "adopting uploaded cover failed") }
    }
}
