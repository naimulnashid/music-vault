package com.musicvault.data.vault

import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.first
import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.musicvault.data.db.DownloadDao
import com.musicvault.data.db.DownloadEntity
import com.musicvault.data.sync.RemoteTrackIndex
import com.musicvault.data.sync.TrackRow
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pinned downloads (tier 2) of vault tracks: one WorkManager job per track,
 * keyed by its library id `vault:<hash>`. Each download comes from a
 * pre-signed URL and is kept only if its bytes hash to the track's content
 * hash. Nothing is written back to Supabase — the row is the track's truth.
 */
@Singleton
class DownloadRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val cache: AudioCache,
    private val downloadDao: DownloadDao,
    private val vaultApi: VaultApi,
    private val remoteTrackIndex: RemoteTrackIndex,
) {
    private val prefs = context.getSharedPreferences("mv_downloads", Context.MODE_PRIVATE)
    private val workManager get() = WorkManager.getInstance(context)

    val downloads: Flow<List<DownloadEntity>> = downloadDao.observeAll()
    val pinnedFileIds: Flow<Set<String>> = cache.pinnedFileIds

    /**
     * Live WorkManager state for queued/running downloads. Lazy: WorkManager
     * must not initialize while Hilt is still injecting the Application (its
     * worker factory isn't set yet).
     */
    val activeWork: Flow<List<WorkInfo>> by lazy { workManager.getWorkInfosByTagFlow(WORK_TAG) }

    var wifiOnly: Boolean
        get() = prefs.getBoolean(KEY_WIFI_ONLY, true)
        set(value) = prefs.edit().putBoolean(KEY_WIFI_ONLY, value).apply()

    var chargingOnly: Boolean
        get() = prefs.getBoolean(KEY_CHARGING_ONLY, false)
        set(value) = prefs.edit().putBoolean(KEY_CHARGING_ONLY, value).apply()

    /** Queues a pinned download of a vault track by its id `vault:<hash>` (no-op when already pinned). */
    fun enqueue(trackId: String) = enqueue(trackId, ExistingWorkPolicy.KEEP)

    private fun enqueue(trackId: String, policy: ExistingWorkPolicy) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .setRequiresCharging(chargingOnly)
            .build()
        val request = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setConstraints(constraints)
            .setInputData(workDataOf(DownloadWorker.KEY_FILE_ID to trackId))
            .addTag(WORK_TAG)
            .addTag("$WORK_TAG-$trackId") // lets the UI identify the track before progress arrives
            .build()
        workManager.enqueueUniqueWork("$WORK_TAG-$trackId", policy, request)
    }

    fun enqueueAll(trackIds: List<String>) = trackIds.forEach { enqueue(it) }

    /**
     * The Wi-Fi / charging options are baked into each queued job, so after
     * changing them re-queue the downloads that haven't started yet.
     */
    suspend fun requeueWaiting() = withContext(Dispatchers.IO) {
        workManager.getWorkInfosByTag(WORK_TAG).get()
            .filter { it.state == androidx.work.WorkInfo.State.ENQUEUED || it.state == androidx.work.WorkInfo.State.BLOCKED }
            .mapNotNull { info -> info.tags.firstOrNull { it.startsWith("$WORK_TAG-") }?.removePrefix("$WORK_TAG-") }
            .forEach { enqueue(it, ExistingWorkPolicy.REPLACE) }
    }

    /** Work ids of failed downloads the user dismissed from the Downloads screen. */
    val dismissedFailures: Set<String>
        get() = prefs.getStringSet(KEY_DISMISSED_FAILURES, emptySet()).orEmpty()

    fun dismissFailure(workId: String) {
        prefs.edit().putStringSet(KEY_DISMISSED_FAILURES, dismissedFailures + workId).apply()
    }

    fun cancel(trackId: String) {
        workManager.cancelUniqueWork("$WORK_TAG-$trackId")
    }

    suspend fun remove(trackId: String) = cache.removeDownload(trackId)

    /**
     * Drops pinned copies of tracks deleted from the vault (here or on another
     * device). Only rows the shadow knows as tombstones count — a row missing
     * from the shadow (not pulled yet) never costs a download.
     */
    suspend fun forgetDeleted(rows: List<TrackRow>): Int = withContext(Dispatchers.IO) {
        var removed = 0
        for (hash in deletedHashes(rows)) {
            val key = AudioCache.vaultKey(hash)
            if (downloadDao.get(key) == null && cache.pinnedVaultFile(hash) == null) continue
            cache.removeDownload(key)
            cache.pinnedVaultFile(hash)?.delete()
            removed++
        }
        if (removed > 0) Timber.i("Removed %d pinned copies of tracks deleted from the vault", removed)
        removed
    }

    // ---- worker internals ---------------------------------------------------------

    /** Runs one download end to end. Called by [DownloadWorker]. */
    suspend fun download(trackId: String, onProgress: suspend (Long, Long) -> Unit) {
        val contentHash = trackId.removePrefix(VaultMerge.VAULT_ID_PREFIX)
        if (downloadDao.get(trackId) != null && cache.pinnedVaultFile(contentHash) != null) return // already pinned
        // WorkManager can run this before the library has loaded in a fresh process;
        // judging "no longer in your vault" then would fail every queued download.
        withTimeoutOrNull(LIBRARY_WAIT_MS) { remoteTrackIndex.loaded.first { it } }
            ?: throw VaultNetworkException("The library hasn't loaded yet")
        val row = remoteTrackIndex.tracks.value.firstOrNull {
            it.contentHash == contentHash && it.deletedAt == null && it.storageKey != null
        } ?: throw VaultException(404, "not_found", "This track is no longer in your vault")
        val storageKey = row.storageKey!!
        val url = vaultApi.signGetOne(storageKey)
            ?: throw VaultException(403, "denied", "The vault refused this track (signed out, or it was deleted)")

        val dest = cache.vaultDownloadTarget(contentHash, storageKey.substringAfterLast('.', ""))
        val part = File(dest.path + ".part")
        val actual = try {
            vaultApi.downloadTo(url, part) { read, total -> onProgress(read, if (total > 0) total else row.fileSize) }
        } catch (e: Exception) {
            // A retry starts from zero, and a final failure must not leave a file nothing tracks.
            part.delete()
            throw e
        }
        if (actual != contentHash) {
            part.delete()
            throw VaultException(0, "integrity", "The downloaded audio doesn't match this track — discarded")
        }
        if (!part.renameTo(dest)) {
            part.delete()
            throw java.io.IOException("Couldn't save ${row.fileName}")
        }
        downloadDao.upsert(
            DownloadEntity(
                fileId = trackId,
                fileName = row.fileName,
                title = row.title,
                artist = row.artist.ifEmpty { "Unknown Artist" },
                sizeBytes = dest.length(),
                path = dest.path,
                downloadedAt = System.currentTimeMillis(),
            ),
        )
        Timber.i("Pinned download complete: %s", row.fileName)
    }

    companion object {
        const val WORK_TAG = "vault-download"
        private const val LIBRARY_WAIT_MS = 30_000L
        private const val KEY_WIFI_ONLY = "wifiOnly"
        private const val KEY_CHARGING_ONLY = "chargingOnly"
        private const val KEY_DISMISSED_FAILURES = "dismissedFailures"

        /** Content hashes of tombstoned rows with no live row sharing the hash. */
        fun deletedHashes(rows: List<TrackRow>): Set<String> {
            val live = rows.filter { it.deletedAt == null }.mapNotNullTo(HashSet()) { it.contentHash }
            return rows.filter { it.deletedAt != null }.mapNotNullTo(HashSet()) { it.contentHash } - live
        }
    }
}
