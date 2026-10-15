package com.musicvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.SmartKey
import com.musicvault.domain.SmartPlaylists
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.EmptyMessage
import com.musicvault.ui.components.HorizontalBorder
import com.musicvault.ui.components.TrackRowInline
import com.musicvault.ui.components.ViewHeader
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Port of GroupedBrowseView.tsx: expandable genre/artist/year/language groups. */
@Composable
fun GroupedBrowseScreen(
    smartKey: SmartKey,
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onArtistClick: (String) -> Unit,
) {
    val colors = LocalVaultColors.current
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()

    val def = SmartPlaylists.def(smartKey)
    val groups = remember(smartKey, tracks) { SmartPlaylists.computeSmartGroups(smartKey, tracks) }
    var expanded by remember { mutableStateOf<String?>(null) }

    Column(modifier = Modifier.fillMaxSize()) {
        ViewHeader(def.label)
        if (groups.isEmpty()) {
            EmptyMessage(def.emptyMessage)
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                groups.forEach { group ->
                    val open = expanded == group.name
                    item(key = "group-${group.name}") {
                        Column {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { expanded = if (open) null else group.name }
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                            ) {
                                Icon(
                                    if (open) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                                    null,
                                    tint = colors.textMuted,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(Modifier.size(8.dp))
                                Text(
                                    group.name,
                                    color = colors.text,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    "${group.tracks.size} ${if (group.tracks.size == 1) "track" else "tracks"}",
                                    color = colors.textMuted,
                                    fontSize = 12.sp,
                                )
                            }
                            HorizontalBorder()
                        }
                    }
                    if (open) {
                        items(group.tracks.size, key = { i -> "g-${group.name}-$i" }) { index ->
                            val track = group.tracks[index]
                            Box(modifier = Modifier.background(colors.bg)) {
                                TrackRowInline(
                                    track = track,
                                    isCurrent = track.id == playback.currentTrack?.id,
                                    isPlaying = playback.isPlaying,
                                    playlists = playlists,
                                    onClick = {
                                        if (track.id == playback.currentTrack?.id) playerViewModel.togglePlay()
                                        else playerViewModel.playQueue(group.tracks, index)
                                    },
                                    onToggleFavorite = { libraryViewModel.toggleFavorite(track.id) },
                                    onAddToPlaylist = { playlistId ->
                                        libraryViewModel.addTrackToPlaylist(playlistId, track.id)
                                    },
                                    onArtistClick = { onArtistClick(track.artist) },
                                )
                                HorizontalBorder(Modifier.align(Alignment.BottomCenter))
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}
