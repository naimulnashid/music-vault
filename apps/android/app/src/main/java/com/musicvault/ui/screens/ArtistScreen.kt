package com.musicvault.ui.screens

import com.musicvault.ui.components.CollectionHeader
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Person
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
import com.musicvault.domain.model.Track
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.EmptyMessage
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Port of ArtistPage.tsx. */
@Composable
fun ArtistScreen(
    artistName: String,
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onBack: () -> Unit,
    onAlbumClick: (key: String) -> Unit,
) {
    val colors = LocalVaultColors.current
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()

    val artistTracks = remember(tracks, artistName) {
        tracks.filter { it.artist == artistName }
            .sortedWith(
                compareBy(String.CASE_INSENSITIVE_ORDER, Track::album)
                    .thenBy(String.CASE_INSENSITIVE_ORDER, Track::title)
            )
    }
    val albums = remember(artistTracks) { Albums.groupAlbums(artistTracks) }

    if (artistTracks.isEmpty()) {
        EmptyMessage("Artist not found.")
        return
    }

    val totalDurationSec = artistTracks.sumOf { it.durationMs } / 1000

    TrackList(
        tracks = artistTracks,
        currentTrackId = playback.currentTrack?.id,
        isPlaying = playback.isPlaying,
        playlists = playlists,
        onPlay = { index -> playerViewModel.playQueue(artistTracks, index) },
        onTogglePlay = playerViewModel::togglePlay,
        onToggleFavorite = libraryViewModel::toggleFavorite,
        onDownload = libraryViewModel::downloadTrack,
        onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
        header = {
            Column(modifier = Modifier.fillMaxWidth()) {
                CollectionHeader(
                    kind = "Artist",
                    title = artistName,
                    tracks = artistTracks,
                    playerViewModel = playerViewModel,
                    meta = "${albums.size} ${if (albums.size == 1) "album" else "albums"} • ${artistTracks.size} ${if (artistTracks.size == 1) "song" else "songs"} • ${Format.formatDurationLong(totalDurationSec)}",
                    coverShape = CircleShape,
                )

                if (albums.isNotEmpty()) {
                    com.musicvault.ui.components.SectionTitle("Albums", modifier = Modifier.padding(top = 4.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        albums.forEach { album ->
                            Column(
                                modifier = Modifier
                                    .width(120.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .clickable { onAlbumClick(album.key) }
                                    .padding(6.dp),
                            ) {
                                AlbumArt(
                                    album.tracks.firstOrNull()?.artworkPath,
                                    modifier = Modifier.size(108.dp),
                                    shape = RoundedCornerShape(10.dp),
                                )
                                Text(
                                    album.album,
                                    color = colors.text,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 6.dp),
                                )
                            }
                        }
                    }
                    com.musicvault.ui.components.SectionTitle("Songs")
                }
            }
        },
    )
}
