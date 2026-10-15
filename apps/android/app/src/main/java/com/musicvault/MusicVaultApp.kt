package com.musicvault

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.musicvault.data.FreshStart
import com.musicvault.data.sync.SyncManager
import com.musicvault.data.vault.AutoDownloader
import dagger.hilt.android.HiltAndroidApp
import timber.log.Timber
import javax.inject.Inject

@HiltAndroidApp
class MusicVaultApp : Application(), Configuration.Provider {

    @Inject lateinit var syncManager: SyncManager
    @Inject lateinit var autoDownloader: AutoDownloader
    @Inject lateinit var workerFactory: HiltWorkerFactory

    /** Hilt-aware WorkManager (DownloadWorker is @HiltWorker). */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
        // Before anything opens the audio cache or the artwork folder.
        FreshStart.runOnce(this)
        // No-op without Supabase credentials; otherwise runs the sync engine
        // for the signed-in session (docs/sync-protocol.md).
        syncManager.start()
        autoDownloader.start()
    }
}
