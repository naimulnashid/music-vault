package com.musicvault.ui.screens

import com.musicvault.ui.components.CollectionHeader
import com.musicvault.ui.components.IconCover
import com.musicvault.domain.Format
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.SmartKey
import com.musicvault.domain.SmartPlaylists
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.EmptyMessage
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.components.ViewHeader
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Port of SmartPlaylistView.tsx + SimpleTrackView.tsx. */
@Composable
fun SmartPlaylistScreen(
    smartKey: SmartKey,
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onArtistClick: (String) -> Unit,
) {
    val colors = LocalVaultColors.current
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val history by libraryViewModel.history.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()

    val def = SmartPlaylists.def(smartKey)
    val result = remember(smartKey, tracks, history) {
        SmartPlaylists.computeSmartTracks(smartKey, tracks, history.toHistoryData())
    }

    TrackList(
        tracks = result,
        currentTrackId = playback.currentTrack?.id,
        isPlaying = playback.isPlaying,
        playlists = playlists,
        onPlay = { index -> playerViewModel.playQueue(result, index) },
        onTogglePlay = playerViewModel::togglePlay,
        onToggleFavorite = libraryViewModel::toggleFavorite,
        onDownload = libraryViewModel::downloadTrack,
        onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
        onArtistClick = onArtistClick,
        emptyMessage = def.emptyMessage,
        header = {
            CollectionHeader(
                kind = "Smart playlist",
                title = def.label,
                tracks = result,
                playerViewModel = playerViewModel,
                meta = if (result.isEmpty()) "Updates automatically"
                else "${result.size} ${if (result.size == 1) "song" else "songs"} • ${Format.formatDurationLong(result.sumOf { it.durationMs } / 1000)}",
                cover = { m -> IconCover(SMART_ICONS.getValue(smartKey), SMART_GRADIENTS.getValue(smartKey), m) },
                extraActions = {
                    if (smartKey == SmartKey.RECENTLY_PLAYED && result.isNotEmpty()) {
                        com.musicvault.ui.components.PillButton("Clear", onClick = { libraryViewModel.clearRecents() })
                    }
                },
            )
        },
    )
}
