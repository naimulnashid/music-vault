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
import com.musicvault.domain.SmartPlaylists
import com.musicvault.ui.components.TrackList
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
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
    val photoPaths by libraryViewModel.artistPhotoPaths.collectAsStateWithLifecycle()
    val photoKeys by libraryViewModel.artistPhotoKeys.collectAsStateWithLifecycle()
    val photoPath = photoPaths[artistName]
    val hasPhoto = artistName in photoKeys
    var menuOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val setPhoto: (android.net.Uri?) -> Unit = { uri ->
        busy = true
        libraryViewModel.setArtistPhoto(artistName, uri) { error ->
            busy = false
            if (error != null) android.widget.Toast.makeText(context, "Couldn't set the photo: $error", android.widget.Toast.LENGTH_LONG).show()
        }
    }
    val pickPhoto = com.musicvault.ui.vault.rememberCoverPicker { setPhoto(it) }

    val artistTracks = remember(tracks, artistName) {
        tracks.filter { SmartPlaylists.hasArtist(it, artistName) }
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
                    cover = photoPath?.let { path -> { m -> AlbumArt(path, modifier = m, shape = CircleShape) } },
                    extraActions = {
                        if (libraryViewModel.canEditArtistPhotos) {
                            Box {
                                IconButton(onClick = { menuOpen = true }, enabled = !busy) {
                                    if (busy) {
                                        CircularProgressIndicator(color = colors.accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                                    } else {
                                        Icon(Icons.Rounded.MoreVert, "More", tint = colors.text)
                                    }
                                }
                                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                    DropdownMenuItem(
                                        text = { Text(if (hasPhoto) "Change photo" else "Choose photo") },
                                        leadingIcon = { Icon(Icons.Rounded.AddPhotoAlternate, null) },
                                        onClick = {
                                            menuOpen = false
                                            pickPhoto()
                                        },
                                    )
                                    if (hasPhoto) {
                                        DropdownMenuItem(
                                            text = { Text("Remove photo") },
                                            leadingIcon = { Icon(Icons.Rounded.Delete, null) },
                                            onClick = {
                                                menuOpen = false
                                                setPhoto(null)
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    },
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
