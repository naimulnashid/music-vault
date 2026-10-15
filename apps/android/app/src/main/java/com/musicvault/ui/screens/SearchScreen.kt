package com.musicvault.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Albums
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.SectionTitle
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Search across the library: artists, albums, then every matching song. */
@Composable
fun SearchScreen(
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onBack: () -> Unit,
    onArtistClick: (String) -> Unit,
    onAlbumClick: (String) -> Unit,
    contentPadding: PaddingValues,
) {
    val colors = LocalVaultColors.current
    val query by libraryViewModel.search.collectAsStateWithLifecycle()
    val songs by libraryViewModel.filteredTracks.collectAsStateWithLifecycle()
    val all by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    val q = query.trim().lowercase()
    val artists = remember(all, q) {
        if (q.isEmpty()) emptyList()
        else all.filter { it.artist.lowercase().contains(q) }
            .groupBy { it.artist }
            .map { (name, tracks) -> name to (tracks.firstOrNull { it.artworkPath != null }?.artworkPath) }
            .take(12)
    }
    val albums = remember(all, q) {
        if (q.isEmpty()) emptyList() else Albums.groupAlbums(all).filter { it.album.lowercase().contains(q) }.take(12)
    }
    val shownSongs = if (q.isEmpty()) emptyList() else songs

    Column {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 8.dp),
        ) {
            IconButton(onClick = {
                libraryViewModel.search.value = ""
                onBack()
            }) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = colors.text)
            }
            SearchField(query, textModifier = Modifier.focusRequester(focus)) { libraryViewModel.search.value = it }
        }

        TrackList(
            tracks = shownSongs,
            currentTrackId = playback.currentTrack?.id,
            isPlaying = playback.isPlaying,
            playlists = playlists,
            onPlay = { index -> playerViewModel.playQueue(shownSongs, index) },
            onTogglePlay = playerViewModel::togglePlay,
            onToggleFavorite = libraryViewModel::toggleFavorite,
            onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
            contentPadding = contentPadding,
            header = {
                Column {
                    if (q.isEmpty()) {
                        Text(
                            "Find songs by title, artist or album.",
                            color = colors.textMuted,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                        )
                    } else if (artists.isEmpty() && albums.isEmpty() && shownSongs.isEmpty()) {
                        Text(
                            "No results for “$query”",
                            color = colors.textMuted,
                            fontSize = 15.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                        )
                    }
                    if (artists.isNotEmpty()) {
                        SectionTitle("Artists", modifier = Modifier.padding(top = 0.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(horizontal = 16.dp)) {
                            items(artists, key = { it.first }) { (name, art) ->
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    modifier = Modifier
                                        .width(96.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .clickable { onArtistClick(name) },
                                ) {
                                    AlbumArt(art, modifier = Modifier.size(96.dp), shape = CircleShape)
                                    Text(
                                        name,
                                        color = colors.text,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.padding(top = 6.dp),
                                    )
                                }
                            }
                        }
                    }
                    if (albums.isNotEmpty()) {
                        SectionTitle("Albums")
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(horizontal = 16.dp)) {
                            items(albums, key = { it.key }) { album ->
                                Column(
                                    modifier = Modifier
                                        .width(132.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .clickable { onAlbumClick(album.key) },
                                ) {
                                    AlbumArt(
                                        album.tracks.firstOrNull()?.artworkPath,
                                        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                                        shape = RoundedCornerShape(12.dp),
                                    )
                                    Text(
                                        album.album,
                                        color = colors.text,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.padding(top = 6.dp),
                                    )
                                    Text(album.artist, color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                    if (shownSongs.isNotEmpty()) SectionTitle("Songs")
                }
            },
        )
    }
}
