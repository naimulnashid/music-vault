package com.musicvault.ui.screens

import com.musicvault.ui.components.CollectionHeader
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Albums
import com.musicvault.domain.Format
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.EmptyMessage
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Port of AlbumPage.tsx. */
@Composable
fun AlbumScreen(
    albumKey: String,
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onBack: () -> Unit,
    onArtistClick: (String) -> Unit,
) {
    val colors = LocalVaultColors.current
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val album = remember(tracks, albumKey) { Albums.groupAlbums(tracks).firstOrNull { it.key == albumKey } }

    if (album == null) {
        EmptyMessage("Album not found.")
        return
    }

    val totalDurationSec = album.tracks.sumOf { it.durationMs } / 1000

    TrackList(
        tracks = album.tracks,
        currentTrackId = playback.currentTrack?.id,
        isPlaying = playback.isPlaying,
        playlists = playlists,
        onPlay = { index -> playerViewModel.playQueue(album.tracks, index) },
        onTogglePlay = playerViewModel::togglePlay,
        onToggleFavorite = libraryViewModel::toggleFavorite,
        onDownload = libraryViewModel::downloadTrack,
        onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
        onArtistClick = onArtistClick,
        header = {
            CollectionHeader(
                kind = "Album",
                title = album.album.ifBlank { "Unknown album" },
                tracks = album.tracks,
                playerViewModel = playerViewModel,
                subtitle = album.artist,
                onSubtitleClick = { onArtistClick(album.artist) },
                meta = listOfNotNull(
                    album.tracks.firstNotNullOfOrNull { it.year }?.toString(),
                    "${album.tracks.size} ${if (album.tracks.size == 1) "song" else "songs"}",
                    Format.formatDurationLong(totalDurationSec),
                ).joinToString(" • "),
            )
        },
    )
}

@Composable
fun PlayPillButton(label: String, onClick: () -> Unit) {
    val colors = LocalVaultColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(colors.accent)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 8.dp),
    ) {
        Icon(Icons.Rounded.PlayArrow, null, tint = colors.accentFg, modifier = Modifier.size(18.dp))
        Spacer(Modifier.size(6.dp))
        Text(label, color = colors.accentFg, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}
