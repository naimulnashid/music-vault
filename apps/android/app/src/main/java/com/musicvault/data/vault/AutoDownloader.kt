package com.musicvault.data.vault

import com.musicvault.data.sync.RemoteTrackIndex
import com.musicvault.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Auto-download: while it is on, every song in the vault is queued as a
 * pinned download, including songs added later. Songs deleted from the vault
 * lose their copies through SyncManager's forgetDeleted, as before.
 */
@Singleton
class AutoDownloader @Inject constructor(
    private val cache: AudioCache,
    // Lazy: WorkManager must not initialize while Hilt injects the Application.
    private val downloads: dagger.Lazy<DownloadRepository>,
    private val remoteTrackIndex: RemoteTrackIndex,
    @ApplicationScope private val scope: CoroutineScope,
) {
    /** Queued this session, so a cancelled or failed download isn't re-queued on every change. */
    private val requested = HashSet<String>()

    @OptIn(FlowPreview::class)
    fun start() {
        scope.launch {
            combine(cache.autoDownloadFlow, remoteTrackIndex.tracks, cache.pinnedFileIds) { on, rows, pinned ->
                Triple(on, rows, pinned)
            }
                .debounce(1_500)
                .collect { (on, rows, pinned) ->
                    if (!on) {
                        requested.clear()
                        return@collect
                    }
                    val missing = rows.asSequence()
                        .filter { it.deletedAt == null && it.storageKey != null }
                        .mapNotNull { it.contentHash?.let(AudioCache::vaultKey) }
                        .filter { it !in pinned && it !in requested }
                        .distinct()
                        .toList()
                    if (missing.isEmpty()) return@collect
                    requested += missing
                    Timber.i("Auto-download queued %d songs", missing.size)
                    downloads.get().enqueueAll(missing)
                }
        }
    }
}
