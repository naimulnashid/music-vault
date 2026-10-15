package com.musicvault

import android.app.SearchManager
import android.content.Intent
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.playback.PlaybackController
import com.musicvault.ui.AppRoot
import com.musicvault.ui.MainViewModel
import com.musicvault.ui.theme.MusicVaultTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    @Inject lateinit var playbackController: PlaybackController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val settings by viewModel.settings.collectAsStateWithLifecycle()
            // Status/navigation bar icons follow the app's theme, not the system's.
            val dark = if (settings.followSystemTheme) androidx.compose.foundation.isSystemInDarkTheme() else settings.theme == com.musicvault.domain.model.ThemeMode.DARK
            androidx.compose.runtime.DisposableEffect(dark) {
                val style = androidx.activity.SystemBarStyle.auto(
                    android.graphics.Color.TRANSPARENT,
                    android.graphics.Color.TRANSPARENT,
                ) { dark }
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                onDispose {}
            }
            MusicVaultTheme(
                theme = if (settings.followSystemTheme) null else settings.theme,
                amoled = settings.amoled,
            ) {
                AppRoot()
            }
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        com.musicvault.demo.DemoShots.theme(intent)?.let { theme ->
            viewModel.setFollowSystemTheme(false)
            viewModel.setTheme(if (theme == "light") com.musicvault.domain.model.ThemeMode.LIGHT else com.musicvault.domain.model.ThemeMode.DARK)
        }
        com.musicvault.demo.DemoShots.offer(intent)
        sharedAudio(intent)?.let {
            com.musicvault.ui.vault.IncomingShares.offer(it)
            return
        }
        if (intent?.action == MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH) {
            playbackController.playFromSearch(intent.getStringExtra(SearchManager.QUERY))
        }
    }

    /** Audio files from "Share → MusicVault" (one or several). */
    @Suppress("DEPRECATION")
    private fun sharedAudio(intent: Intent?): List<android.net.Uri>? {
        intent ?: return null
        return when (intent.action) {
            Intent.ACTION_SEND -> (intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM))?.let { listOf(it) }
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<android.net.Uri>(Intent.EXTRA_STREAM)
            else -> null
        }
    }
}
