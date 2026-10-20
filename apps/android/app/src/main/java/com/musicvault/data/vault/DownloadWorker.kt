package com.musicvault.data.vault

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.musicvault.R
import com.musicvault.data.repo.LibraryRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import timber.log.Timber
import java.io.IOException

/**
 * One pinned download, battery-friendly via WorkManager constraints
 * (Wi-Fi-only / charging-only options live on [DownloadRepository]). Runs as
 * a foreground worker with a progress notification, so long downloads keep
 * going with the screen off and you can see how far along they are.
 */
@HiltWorker
class DownloadWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val downloadRepository: DownloadRepository,
    private val libraryRepository: LibraryRepository,
) : CoroutineWorker(context, params) {

    private var title: String = "Song"

    override suspend fun doWork(): Result {
        val fileId = inputData.getString(KEY_FILE_ID) ?: return Result.failure()
        title = runCatching { libraryRepository.getTrack(fileId)?.title }.getOrNull() ?: title
        runCatching { setForeground(foregroundInfo(fileId, null)) }
            .onFailure { Timber.w(it, "download %s: couldn't go foreground", fileId) }
        var lastPercent = -1
        return try {
            downloadRepository.download(fileId) { read, total ->
                // Only report whole-percent steps: every buffer would flood
                // WorkManager's database and the notification shade.
                val percent = if (total > 0) ((read * 100) / total).toInt() else -1
                if (percent != lastPercent) {
                    lastPercent = percent
                    setProgress(
                        workDataOf(
                            KEY_FILE_ID to fileId,
                            KEY_BYTES_READ to read,
                            KEY_BYTES_TOTAL to total,
                        ),
                    )
                    runCatching { setForeground(foregroundInfo(fileId, percent.takeIf { it >= 0 })) }
                }
            }
            Result.success(workDataOf(KEY_FILE_ID to fileId))
        } catch (e: IOException) {
            Timber.w(e, "download of %s hit a network error; retrying", fileId)
            if (runAttemptCount < MAX_RETRIES) Result.retry() else failure(fileId, e)
        } catch (e: VaultNetworkException) {
            Timber.w(e, "download of %s couldn't reach the vault; retrying", fileId)
            if (runAttemptCount < MAX_RETRIES) Result.retry() else failure(fileId, e)
        } catch (e: Exception) {
            Timber.e(e, "download of %s failed", fileId)
            failure(fileId, e)
        }
    }

    /** A failed job keeps its reason so the Downloads screen can show it with Retry. */
    private fun failure(fileId: String, error: Throwable): Result =
        Result.failure(workDataOf(KEY_FILE_ID to fileId, KEY_ERROR to DownloadErrors.reason(error)))

    override suspend fun getForegroundInfo(): ForegroundInfo =
        foregroundInfo(inputData.getString(KEY_FILE_ID) ?: "download", null)

    private fun foregroundInfo(fileId: String, percent: Int?): ForegroundInfo {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Progress of songs downloading to this device"
                },
            )
        }
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(if (percent == null) "Waiting to download…" else "Downloading · $percent%")
            .setProgress(100, percent ?: 0, percent == null)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build()
        val id = NOTIFICATION_BASE + (fileId.hashCode() and 0xFFFF)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(id, notification)
        }
    }

    companion object {
        const val KEY_FILE_ID = "fileId"
        const val KEY_BYTES_READ = "bytesRead"
        const val KEY_BYTES_TOTAL = "bytesTotal"
        const val KEY_ERROR = "error"
        private const val MAX_RETRIES = 5
        private const val CHANNEL_ID = "downloads"
        private const val NOTIFICATION_BASE = 40_000
    }
}
