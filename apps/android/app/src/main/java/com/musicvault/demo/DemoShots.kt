package com.musicvault.demo

import android.content.Intent
import com.musicvault.BuildConfig
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * Which screen the screenshot script wants next. It starts MainActivity with
 * `--es demo_screen <name>` (library, album, now-playing, statistics,
 * downloads) and `--es demo_theme dark|light`; AppRoot navigates there. Only
 * the demo build listens, so these extras do nothing in a real install.
 */
object DemoShots {
    private val _screens = MutableSharedFlow<String>(replay = 1, extraBufferCapacity = 1)
    val screens: SharedFlow<String> = _screens

    /** The requested theme, or null when the intent names none. */
    fun theme(intent: Intent?): String? = if (BuildConfig.DEMO) intent?.getStringExtra("demo_theme") else null

    fun offer(intent: Intent?) {
        if (!BuildConfig.DEMO) return
        intent?.getStringExtra("demo_screen")?.let { _screens.tryEmit(it) }
    }
}
