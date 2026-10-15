package com.musicvault.ui.vault

import android.net.Uri
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** Audio files shared to MusicVault ("Share → MusicVault"), handed from MainActivity to the UI. */
object IncomingShares {
    private val _uris = MutableSharedFlow<List<Uri>>(replay = 1, extraBufferCapacity = 4)
    val uris: SharedFlow<List<Uri>> = _uris.asSharedFlow()

    fun offer(uris: List<Uri>) {
        if (uris.isNotEmpty()) _uris.tryEmit(uris)
    }
}
