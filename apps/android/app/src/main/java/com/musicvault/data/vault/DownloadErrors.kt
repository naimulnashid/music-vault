package com.musicvault.data.vault

import com.musicvault.playback.PlaybackErrors
import java.io.IOException

/** The reason shown next to a download that failed. */
object DownloadErrors {
    fun reason(error: Throwable): String = when {
        // The vault's own messages are already written for people.
        error is VaultException -> error.message ?: "The vault refused this track"
        error is VaultNetworkException || PlaybackErrors.isNetworkFailure(error) -> "Couldn't reach the vault"
        error is IOException && error.message.orEmpty().let { "ENOSPC" in it || "No space left" in it } ->
            "Not enough storage on this device"
        else -> "Download failed"
    }
}
