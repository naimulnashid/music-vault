package com.musicvault.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import com.musicvault.data.db.DownloadEntity
import com.musicvault.data.vault.AudioCache
import com.musicvault.data.vault.DownloadRepository
import com.musicvault.data.vault.DownloadWorker
import com.musicvault.data.repo.LibraryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** One queued/running download for the UI. */
data class ActiveDownload(
    val fileId: String,
    val title: String,
    /** 0..1, or null while the size is unknown. */
    val progress: Float?,
)

/** A download whose job gave up, kept on screen with its reason until retried or dismissed. */
data class FailedDownload(
    val workId: String,
    val fileId: String,
    val title: String,
    val reason: String,
)

@HiltViewModel
class DownloadsViewModel @Inject constructor(
    private val downloadRepository: DownloadRepository,
    private val libraryRepository: LibraryRepository,
    private val audioCache: AudioCache,
) : ViewModel() {

    val autoDownload: StateFlow<Boolean> = audioCache.autoDownloadFlow
    val maxCacheBytes: StateFlow<Long> = audioCache.maxCacheBytesFlow

    private val _cacheUsage = MutableStateFlow(0L)
    val cacheUsage: StateFlow<Long> = _cacheUsage.asStateFlow()

    fun refreshCacheUsage() = viewModelScope.launch { _cacheUsage.value = audioCache.cacheUsageBytes() }

    fun setAutoDownload(on: Boolean) = viewModelScope.launch {
        audioCache.setAutoDownload(on)
        refreshCacheUsage()
    }

    fun setMaxCacheBytes(bytes: Long) = viewModelScope.launch {
        audioCache.setMaxCacheBytes(bytes)
        refreshCacheUsage()
    }

    fun clearCache() = viewModelScope.launch {
        audioCache.clearAutoCache()
        refreshCacheUsage()
    }

    val downloads: StateFlow<List<DownloadEntity>> = downloadRepository.downloads
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val activeDownloads: StateFlow<List<ActiveDownload>> = downloadRepository.activeWork
        .map { infos -> infos.filter { !it.state.isFinished }.map { it.toActive() } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val dismissedFailures = MutableStateFlow(downloadRepository.dismissedFailures)

    val failedDownloads: StateFlow<List<FailedDownload>> =
        combine(downloadRepository.activeWork, dismissedFailures) { infos, dismissed ->
            infos.filter { it.state == WorkInfo.State.FAILED && it.id.toString() !in dismissed }.map { it.toFailed() }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun retryDownload(fileId: String) = downloadRepository.enqueue(fileId)

    fun dismissFailure(item: FailedDownload) {
        downloadRepository.dismissFailure(item.workId)
        dismissedFailures.value = downloadRepository.dismissedFailures
    }

    private suspend fun WorkInfo.toFailed(): FailedDownload {
        val fileId = outputData.getString(DownloadWorker.KEY_FILE_ID)
            ?: tags.firstOrNull { it.startsWith("${DownloadRepository.WORK_TAG}-") }
                ?.removePrefix("${DownloadRepository.WORK_TAG}-")
            ?: ""
        return FailedDownload(
            workId = id.toString(),
            fileId = fileId,
            title = libraryRepository.getTrack(fileId)?.title ?: fileId,
            reason = outputData.getString(DownloadWorker.KEY_ERROR) ?: "Download failed",
        )
    }

    private val _wifiOnly = MutableStateFlow(downloadRepository.wifiOnly)
    val wifiOnly: StateFlow<Boolean> = _wifiOnly.asStateFlow()

    private val _chargingOnly = MutableStateFlow(downloadRepository.chargingOnly)
    val chargingOnly: StateFlow<Boolean> = _chargingOnly.asStateFlow()

    fun setWifiOnly(value: Boolean) {
        downloadRepository.wifiOnly = value
        _wifiOnly.value = value
        viewModelScope.launch { downloadRepository.requeueWaiting() }
    }

    fun setChargingOnly(value: Boolean) {
        downloadRepository.chargingOnly = value
        _chargingOnly.value = value
        viewModelScope.launch { downloadRepository.requeueWaiting() }
    }

    fun cancel(fileId: String) = downloadRepository.cancel(fileId)

    fun remove(fileId: String) = viewModelScope.launch { downloadRepository.remove(fileId) }

    private suspend fun WorkInfo.toActive(): ActiveDownload {
        val fileId = progress.getString(DownloadWorker.KEY_FILE_ID)
            ?: tags.firstOrNull { it.startsWith("${DownloadRepository.WORK_TAG}-") }
                ?.removePrefix("${DownloadRepository.WORK_TAG}-")
            ?: ""
        val read = progress.getLong(DownloadWorker.KEY_BYTES_READ, 0)
        val total = progress.getLong(DownloadWorker.KEY_BYTES_TOTAL, -1)
        val title = libraryRepository.getTrack(fileId)?.title ?: fileId
        return ActiveDownload(
            fileId = fileId,
            title = title,
            progress = if (total > 0) (read.toFloat() / total).coerceIn(0f, 1f) else null,
        )
    }
}
