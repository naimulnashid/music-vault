package com.musicvault.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** The message shown when a song can't be loaded (web/desktop: lib/playbackError.ts). */
object PlaybackErrors {

    /** Offline gets its own wording: the cause is the connection, not the song. */
    fun message(title: String, offline: Boolean): String =
        if (offline) "$title: Not available offline" else "$title: Couldn't play this song"

    /** True when [error] or anything that caused it is a failure to reach the network. */
    fun isNetworkFailure(error: Throwable): Boolean =
        generateSequence(error) { it.cause }.take(16).any {
            it is UnknownHostException || it is ConnectException || it is SocketTimeoutException
        }

    fun isOffline(context: Context, error: Throwable): Boolean {
        if (isNetworkFailure(error)) return true
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return true
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}
