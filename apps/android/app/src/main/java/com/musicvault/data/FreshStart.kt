package com.musicvault.data

import android.content.Context
import timber.log.Timber
import java.io.File

/**
 * The library was rebuilt from scratch when Google Drive and local folders
 * were retired (docs/drive-to-r2-migration.md, decision 8). Room clears its
 * part in the v7 migration; this clears the files that went with the old
 * library — pinned and cached audio, extracted cover art, upload staging —
 * and the Drive sign-in, once, at app start before anything opens them.
 * Device preferences (theme, EQ, download options) are kept.
 */
object FreshStart {
    private const val PREFS = "mv_fresh_start"
    private const val KEY_DONE = "done"
    private const val VERSION = "2026-10-11"

    fun runOnce(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_DONE, null) == VERSION) return
        for (dir in listOf("downloads", "audio-cache", "artwork")) {
            File(context.filesDir, dir).deleteRecursively()
        }
        File(context.cacheDir, "upload").deleteRecursively()
        context.deleteSharedPreferences("mv_drive_auth")
        prefs.edit().putString(KEY_DONE, VERSION).apply()
        Timber.i("fresh start: cleared the old library's files")
    }
}
