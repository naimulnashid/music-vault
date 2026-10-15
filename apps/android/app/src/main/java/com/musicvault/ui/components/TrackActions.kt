package com.musicvault.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.automirrored.rounded.PlaylistPlay
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.RemoveCircleOutline
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.domain.model.Playlist
import com.musicvault.domain.model.Track
import com.musicvault.ui.theme.LocalVaultColors
import kotlinx.coroutines.launch

/**
 * Everything a song menu can do, provided once by AppRoot so every list
 * (library, albums, playlists, queue, player) offers the same actions —
 * the mobile counterpart of the desktop/web TrackMenu.
 */
class TrackActions(
    val playNext: (Track) -> Unit,
    val addToQueue: (Track) -> Unit,
    val toggleFavorite: (trackId: String) -> Unit,
    /** Manual playlists a song can be added to. */
    val playlists: List<Playlist>,
    val addToPlaylist: (playlistId: String, trackId: String) -> Unit,
    val download: (trackId: String) -> Unit,
    val removeDownload: (trackId: String) -> Unit,
    val cancelDownload: (trackId: String) -> Unit,
    val openAlbum: (Track) -> Unit,
    val openArtist: (artist: String) -> Unit,
    val edit: ((trackIds: List<String>) -> Unit)?,
    val deleteFromVault: ((trackIds: List<String>) -> Unit)?,
    val pinnedIds: Set<String>,
    /** In-flight downloads: track id → progress (null = size unknown yet). */
    val downloads: Map<String, Float?>,
)

val LocalTrackActions = compositionLocalOf<TrackActions?> { null }

/** Per-song download badge: a filling ring while downloading, a tick once kept. */
@Composable
fun DownloadBadge(trackId: String, modifier: Modifier = Modifier) {
    val actions = LocalTrackActions.current ?: return
    val colors = LocalVaultColors.current
    when {
        actions.downloads.containsKey(trackId) -> ProgressRing(actions.downloads[trackId], modifier, size = 18.dp)
        trackId in actions.pinnedIds -> Box(
            contentAlignment = Alignment.Center,
            modifier = modifier
                .size(16.dp)
                .clip(CircleShape)
                .background(colors.accent),
        ) {
            Icon(Icons.Rounded.Check, "Downloaded", tint = colors.accentFg, modifier = Modifier.size(11.dp))
        }
    }
}

/**
 * The song menu as a bottom sheet. [onRemoveFromPlaylist] adds the playlist
 * entry; [editIds] lets a selection be edited together.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackActionsSheet(
    track: Track,
    onDismiss: () -> Unit,
    onRemoveFromPlaylist: (() -> Unit)? = null,
    editIds: List<String>? = null,
) {
    val actions = LocalTrackActions.current ?: return
    val colors = LocalVaultColors.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var choosingPlaylist by remember { mutableStateOf(false) }

    fun close(then: () -> Unit) {
        scope.launch { sheetState.hide() }.invokeOnCompletion {
            onDismiss()
            then()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(bottom = 8.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            ) {
                AlbumArt(track.artworkPath, modifier = Modifier.size(52.dp))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(track.title, color = colors.text, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(track.artist, color = colors.textMuted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.height(10.dp))
            Hairline()
            Spacer(Modifier.height(6.dp))

            if (choosingPlaylist) {
                Text(
                    "Add to playlist",
                    color = colors.text,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                if (actions.playlists.isEmpty()) {
                    Text(
                        "No playlists yet — create one from the Collections tab.",
                        color = colors.textMuted,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    )
                }
                actions.playlists.forEach { playlist ->
                    SheetItem(Icons.AutoMirrored.Rounded.QueueMusic, playlist.name) {
                        close { actions.addToPlaylist(playlist.id, track.id) }
                    }
                }
                return@Column
            }

            SheetItem(Icons.AutoMirrored.Rounded.PlaylistPlay, "Play next") { close { actions.playNext(track) } }
            SheetItem(Icons.AutoMirrored.Rounded.QueueMusic, "Add to queue") { close { actions.addToQueue(track) } }
            SheetItem(Icons.AutoMirrored.Rounded.PlaylistAdd, "Add to playlist") { choosingPlaylist = true }
            SheetItem(
                if (track.favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                if (track.favorite) "Remove from favorites" else "Add to favorites",
                tint = if (track.favorite) colors.accent else null,
            ) { close { actions.toggleFavorite(track.id) } }
            SheetItem(Icons.Rounded.Album, "Go to album") { close { actions.openAlbum(track) } }
            SheetItem(Icons.Rounded.Person, "Go to artist") { close { actions.openArtist(track.artist) } }
            when {
                track.id in actions.downloads -> SheetItem(Icons.Rounded.Download, "Downloading…", enabled = false) {}
                track.id in actions.pinnedIds -> SheetItem(Icons.Rounded.DownloadDone, "Remove download", tint = colors.accent) {
                    close { actions.removeDownload(track.id) }
                }
                track.storageKey != null -> SheetItem(Icons.Rounded.Download, "Download") { close { actions.download(track.id) } }
            }
            actions.edit?.let { edit ->
                val ids = editIds?.takeIf { it.isNotEmpty() } ?: listOf(track.id)
                SheetItem(Icons.Rounded.Edit, if (ids.size > 1) "Edit ${ids.size} songs" else "Edit details") { close { edit(ids) } }
            }
            if (onRemoveFromPlaylist != null) {
                SheetItem(Icons.Rounded.RemoveCircleOutline, "Remove from playlist") { close(onRemoveFromPlaylist) }
            }
            actions.deleteFromVault?.takeIf { track.storageKey != null }?.let { delete ->
                SheetItem(Icons.Rounded.CloudOff, "Delete from vault", tint = colors.danger, textColor = colors.danger) {
                    close { delete(listOf(track.id)) }
                }
            }
        }
    }
}

@Composable
private fun SheetItem(
    icon: ImageVector,
    label: String,
    tint: Color? = null,
    textColor: Color? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = LocalVaultColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 14.dp),
    ) {
        Icon(icon, null, tint = tint ?: colors.textMuted, modifier = Modifier.size(22.dp))
        Text(label, color = (textColor ?: colors.text).copy(alpha = if (enabled) 1f else 0.5f), fontSize = 15.sp)
    }
}
