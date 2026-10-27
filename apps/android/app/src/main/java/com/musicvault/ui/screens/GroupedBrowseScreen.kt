package com.musicvault.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.data.vault.CollectionCovers
import com.musicvault.domain.Format
import com.musicvault.domain.SmartKey
import com.musicvault.domain.SmartPlaylists
import com.musicvault.domain.model.Track
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.ArtMosaic
import com.musicvault.ui.components.CollectionHeader
import com.musicvault.ui.components.EmptyMessage
import com.musicvault.ui.components.ScreenTitle
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.components.mosaicArts
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Collection key for one group of a grouped smart playlist (core collectionKey). */
private fun groupCollection(smartKey: SmartKey, name: String) = CollectionCovers.key(smartKey.name.lowercase(), name)

/**
 * "By Artist / Genre / Year / Language / Country" as desktop/web show it: a
 * card per group with its cover; a tap opens the group's own page (artists
 * open their artist page). A long press changes the cover without opening it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun GroupedBrowseScreen(
    smartKey: SmartKey,
    libraryViewModel: LibraryViewModel,
    onGroupClick: (name: String) -> Unit,
    onArtistClick: (String) -> Unit,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val colors = LocalVaultColors.current
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val photos by libraryViewModel.artistPhotoPaths.collectAsStateWithLifecycle()
    val covers by libraryViewModel.collectionCoverPaths.collectAsStateWithLifecycle()
    val def = SmartPlaylists.def(smartKey)
    val groups = remember(smartKey, tracks) { SmartPlaylists.computeSmartGroups(smartKey, tracks) }
    val isArtist = smartKey == SmartKey.ARTIST

    if (groups.isEmpty()) {
        Column(Modifier.fillMaxSize()) {
            ScreenTitle(def.label)
            EmptyMessage(def.emptyMessage)
        }
        return
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(150.dp),
        contentPadding = contentPadding,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize().padding(horizontal = 4.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            ScreenTitle(def.label, subtitle = "${groups.size} ${if (isArtist) "artists" else "groups"}")
        }
        items(groups, key = { it.name }) { group ->
            val collection = groupCollection(smartKey, group.name)
            var menuOpen by remember { mutableStateOf(false) }
            Column(
                horizontalAlignment = if (isArtist) Alignment.CenterHorizontally else Alignment.Start,
                modifier = Modifier
                    .padding(horizontal = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .combinedClickable(
                        onClick = { if (isArtist) onArtistClick(group.name) else onGroupClick(group.name) },
                        onLongClick = if (isArtist || !libraryViewModel.canEditArtistPhotos) null else ({ menuOpen = true }),
                    ),
            ) {
                Box {
                    if (isArtist) {
                        val art = photos[group.name] ?: group.tracks.firstNotNullOfOrNull { it.artworkPath }
                        AlbumArt(art, modifier = Modifier.fillMaxWidth().aspectRatio(1f), shape = CircleShape)
                    } else {
                        GroupCover(covers[collection], group.tracks, Modifier.fillMaxWidth().aspectRatio(1f), RoundedCornerShape(12.dp))
                    }
                    CoverMenu(libraryViewModel, collection, menuOpen) { menuOpen = false }
                }
                Text(
                    group.name,
                    color = colors.text,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = if (isArtist) TextAlign.Center else TextAlign.Start,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text(
                    "${group.tracks.size} ${if (group.tracks.size == 1) "song" else "songs"}",
                    color = colors.textMuted,
                    fontSize = 12.sp,
                )
            }
        }
    }
}

/** The picked cover, else the songs' mosaic, else a plain tile. */
@Composable
private fun GroupCover(custom: String?, tracks: List<Track>, modifier: Modifier, shape: Shape) {
    val colors = LocalVaultColors.current
    val arts = mosaicArts(tracks)
    when {
        custom != null -> AlbumArt(custom, modifier = modifier, shape = shape)
        arts.isNotEmpty() -> ArtMosaic(arts, modifier = modifier, shape = shape)
        else -> Box(contentAlignment = Alignment.Center, modifier = modifier.clip(shape).background(colors.surface2)) {
            Icon(Icons.AutoMirrored.Rounded.QueueMusic, null, tint = colors.textMuted, modifier = Modifier.size(40.dp))
        }
    }
}

/** "Choose cover" / "Use default cover" for one collection; also used by the group page's ⋮. */
@Composable
private fun CoverMenu(libraryViewModel: LibraryViewModel, collection: String, expanded: Boolean, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val keys by libraryViewModel.collectionCoverKeys.collectAsStateWithLifecycle()
    val hasCover = collection in keys
    val set: (android.net.Uri?) -> Unit = { uri ->
        libraryViewModel.setCollectionCover(collection, uri) { error ->
            if (error != null) android.widget.Toast.makeText(context, "Couldn't set the cover: $error", android.widget.Toast.LENGTH_LONG).show()
        }
    }
    val pickCover = com.musicvault.ui.vault.rememberCoverPicker { set(it) }
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text(if (hasCover) "Change cover" else "Choose cover") },
            leadingIcon = { Icon(Icons.Rounded.AddPhotoAlternate, null) },
            onClick = {
                onDismiss()
                pickCover()
            },
        )
        if (hasCover) {
            DropdownMenuItem(
                text = { Text("Use default cover") },
                leadingIcon = { Icon(Icons.Rounded.RestartAlt, null) },
                onClick = {
                    onDismiss()
                    set(null)
                },
            )
        }
    }
}

/** One group of a grouped smart playlist on its own page: header, then its songs. */
@Composable
fun GroupScreen(
    smartKey: SmartKey,
    name: String,
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onArtistClick: (String) -> Unit,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val colors = LocalVaultColors.current
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val covers by libraryViewModel.collectionCoverPaths.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val def = SmartPlaylists.def(smartKey)
    val group = remember(smartKey, tracks, name) { SmartPlaylists.computeSmartGroups(smartKey, tracks).firstOrNull { it.name == name } }
    if (group == null) {
        EmptyMessage("${def.label.removePrefix("By ")} not found.")
        return
    }
    val collection = groupCollection(smartKey, name)
    val custom = covers[collection]
    var menuOpen by remember { mutableStateOf(false) }

    TrackList(
        tracks = group.tracks,
        currentTrackId = playback.currentTrack?.id,
        isPlaying = playback.isPlaying,
        playlists = playlists,
        onPlay = { index -> playerViewModel.playQueue(group.tracks, index) },
        onTogglePlay = playerViewModel::togglePlay,
        onToggleFavorite = libraryViewModel::toggleFavorite,
        onDownload = libraryViewModel::downloadTrack,
        onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
        onArtistClick = onArtistClick,
        contentPadding = contentPadding,
        header = {
            CollectionHeader(
                kind = def.label.removePrefix("By "),
                title = name,
                tracks = group.tracks,
                playerViewModel = playerViewModel,
                meta = "${group.tracks.size} ${if (group.tracks.size == 1) "song" else "songs"} • ${Format.formatDurationLong(group.tracks.sumOf { it.durationMs } / 1000)}",
                cover = { m -> GroupCover(custom, group.tracks, m, RoundedCornerShape(14.dp)) },
                extraActions = {
                    if (libraryViewModel.canEditArtistPhotos) {
                        Box {
                            IconButton(onClick = { menuOpen = true }) {
                                Icon(Icons.Rounded.MoreVert, "More", tint = colors.text)
                            }
                            CoverMenu(libraryViewModel, collection, menuOpen) { menuOpen = false }
                        }
                    }
                },
            )
        },
    )
}
