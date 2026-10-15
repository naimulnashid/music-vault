package com.musicvault.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.DragHandle
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.musicvault.domain.model.Playlist
import com.musicvault.domain.model.Track
import com.musicvault.ui.theme.LocalVaultColors

val TRACK_ROW_HEIGHT = 64.dp

/**
 * Port of TrackList.tsx: tap to play, ⋮ (or long-press for a selection) for
 * the song menu, optional drag-to-reorder (fixed-height rows keep the drag
 * math simple), artist tap-through, live download badges.
 */
@Composable
fun TrackList(
    tracks: List<Track>,
    currentTrackId: String?,
    isPlaying: Boolean,
    playlists: List<Playlist>,
    onPlay: (index: Int) -> Unit,
    onTogglePlay: () -> Unit,
    onToggleFavorite: (trackId: String) -> Unit,
    onAddToPlaylist: (playlistId: String, trackId: String) -> Unit,
    onArtistClick: ((artist: String) -> Unit)? = null,
    onRemoveFromPlaylist: ((trackId: String) -> Unit)? = null,
    onDownload: ((trackId: String) -> Unit)? = null,
    draggable: Boolean = false,
    onReorder: ((fromIndex: Int, toIndex: Int) -> Unit)? = null,
    listState: LazyListState = rememberLazyListState(),
    header: (@Composable () -> Unit)? = null,
    /** Opens the details editor for these track ids (null = editing unavailable). */
    onEdit: ((trackIds: List<String>) -> Unit)? = null,
    /** Asks to delete these tracks from the vault (null = unavailable). */
    onDeleteFromVault: ((trackIds: List<String>) -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(bottom = 16.dp),
    /** Shown when [tracks] is empty (null = the header handles it). */
    emptyMessage: String? = "No songs here yet.",
) {
    val colors = LocalVaultColors.current
    // Long-press starts a selection; while one exists, taps toggle rows.
    var selection by remember { mutableStateOf(setOf<String>()) }
    val selectable = onEdit != null || onDeleteFromVault != null
    val selectedIds = tracks.filter { it.id in selection }.map { it.id }

    var draggingIndex by remember { mutableIntStateOf(-1) }
    var dragOffset by remember { mutableFloatStateOf(0f) }
    val rowHeightPx = with(LocalDensity.current) { TRACK_ROW_HEIGHT.toPx() }

    LazyColumn(state = listState, contentPadding = contentPadding, modifier = Modifier.fillMaxSize()) {
        if (header != null) {
            item(key = "header") { header() }
        }
        item(key = "selection") {
            AnimatedVisibility(
                visible = selectedIds.isNotEmpty(),
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                val vaultCount = tracks.count { it.id in selection && it.storageKey != null }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                        .fillMaxWidth()
                        .clip(CircleShape)
                        .background(colors.surface3)
                        .padding(start = 18.dp, end = 4.dp),
                ) {
                    Text(
                        "${selectedIds.size} selected",
                        color = colors.text,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    if (onEdit != null) {
                        IconButton(onClick = { onEdit(selectedIds) }) {
                            Icon(Icons.Rounded.Edit, "Edit details", tint = colors.text, modifier = Modifier.size(20.dp))
                        }
                    }
                    if (onDeleteFromVault != null && vaultCount > 0) {
                        IconButton(onClick = {
                            onDeleteFromVault(tracks.filter { it.id in selection && it.storageKey != null }.map { it.id })
                            selection = emptySet()
                        }) {
                            Icon(Icons.Rounded.CloudOff, "Delete from vault", tint = colors.danger, modifier = Modifier.size(20.dp))
                        }
                    }
                    IconButton(onClick = { selection = emptySet() }) {
                        Icon(Icons.Rounded.Close, "Clear selection", tint = colors.textMuted, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
        if (tracks.isEmpty() && emptyMessage != null) {
            item(key = "empty") {
                Text(
                    emptyMessage,
                    color = colors.textMuted,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 24.dp),
                )
            }
        }
        itemsIndexed(tracks, key = { index, track -> "${track.id}-$index" }) { index, track ->
            val isDraggingThis = draggingIndex == index
            Box(
                modifier = Modifier
                    .zIndex(if (isDraggingThis) 1f else 0f)
                    .graphicsLayer { translationY = if (isDraggingThis) dragOffset else 0f }
                    .then(if (isDraggingThis) Modifier.shadow(12.dp, RoundedCornerShape(12.dp)) else Modifier),
            ) {
                TrackRowInline(
                    track = track,
                    isCurrent = track.id == currentTrackId,
                    isPlaying = isPlaying,
                    playlists = playlists,
                    onClick = {
                        when {
                            selection.isNotEmpty() ->
                                selection = if (track.id in selection) selection - track.id else selection + track.id
                            track.id == currentTrackId -> onTogglePlay()
                            else -> onPlay(index)
                        }
                    },
                    onLongClick = if (selectable) {
                        { selection = if (track.id in selection) selection - track.id else selection + track.id }
                    } else null,
                    selected = track.id in selection,
                    editIds = if (track.id in selection) selectedIds else null,
                    onToggleFavorite = { onToggleFavorite(track.id) },
                    onAddToPlaylist = { playlistId -> onAddToPlaylist(playlistId, track.id) },
                    onArtistClick = onArtistClick?.let { cb -> { cb(track.artist) } },
                    onRemoveFromPlaylist = onRemoveFromPlaylist?.let { cb -> { cb(track.id) } },
                    highlighted = isDraggingThis,
                    dragHandle = if (draggable && onReorder != null) {
                        {
                            Icon(
                                Icons.Rounded.DragHandle,
                                contentDescription = "Reorder",
                                tint = colors.subtle,
                                modifier = Modifier
                                    .size(22.dp)
                                    .pointerInput(index, tracks.size) {
                                        detectDragGestures(
                                            onDragStart = {
                                                draggingIndex = index
                                                dragOffset = 0f
                                            },
                                            onDragEnd = {
                                                draggingIndex = -1
                                                dragOffset = 0f
                                            },
                                            onDragCancel = {
                                                draggingIndex = -1
                                                dragOffset = 0f
                                            },
                                        ) { change, dragAmount ->
                                            change.consume()
                                            dragOffset += dragAmount.y
                                            while (dragOffset > rowHeightPx / 2 && draggingIndex < tracks.size - 1) {
                                                onReorder(draggingIndex, draggingIndex + 1)
                                                draggingIndex += 1
                                                dragOffset -= rowHeightPx
                                            }
                                            while (dragOffset < -rowHeightPx / 2 && draggingIndex > 0) {
                                                onReorder(draggingIndex, draggingIndex - 1)
                                                draggingIndex -= 1
                                                dragOffset += rowHeightPx
                                            }
                                        }
                                    },
                            )
                        }
                    } else null,
                )
            }
        }
    }
}

/** A single song row; also used standalone by the grouped browse screen. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TrackRowInline(
    track: Track,
    isCurrent: Boolean,
    isPlaying: Boolean,
    playlists: List<Playlist>,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
    onAddToPlaylist: (playlistId: String) -> Unit,
    @Suppress("UNUSED_PARAMETER") onArtistClick: (() -> Unit)? = null,
    onRemoveFromPlaylist: (() -> Unit)? = null,
    @Suppress("UNUSED_PARAMETER") onDownload: (() -> Unit)? = null,
    dragHandle: (@Composable () -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    selected: Boolean = false,
    @Suppress("UNUSED_PARAMETER") onEdit: (() -> Unit)? = null,
    @Suppress("UNUSED_PARAMETER") onDeleteFromVault: (() -> Unit)? = null,
    /** Ids the menu's "Edit" acts on when this row is part of a selection. */
    editIds: List<String>? = null,
    highlighted: Boolean = false,
) {
    val colors = LocalVaultColors.current
    var menuOpen by remember { mutableStateOf(false) }
    val bg by animateColorAsState(
        when {
            selected -> colors.accentSoft
            highlighted -> colors.surface3
            else -> Color.Transparent
        },
        label = "rowBg",
    )

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(TRACK_ROW_HEIGHT)
            .padding(horizontal = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(start = 8.dp),
    ) {
        if (dragHandle != null) {
            dragHandle()
            Spacer(Modifier.width(8.dp))
        }

        Box(modifier = Modifier.size(48.dp)) {
            AlbumArt(track.artworkPath, modifier = Modifier.fillMaxSize(), shape = RoundedCornerShape(6.dp))
            if (isCurrent) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.Black.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    NowPlayingBars(playing = isPlaying, color = Color.White, height = 16.dp)
                }
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 14.dp),
        ) {
            Text(
                track.title,
                color = if (isCurrent) colors.accent else colors.text,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                DownloadBadge(track.id, modifier = Modifier.padding(end = 6.dp))
                Text(
                    buildString {
                        append(track.artist)
                        if (track.album.isNotBlank()) append(" • ").append(track.album)
                    },
                    color = colors.textMuted,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (track.favorite) {
            IconButton(onClick = onToggleFavorite, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Rounded.Favorite, "Remove from favorites", tint = colors.accent, modifier = Modifier.size(18.dp))
            }
        }

        IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(44.dp)) {
            Icon(Icons.Rounded.MoreVert, contentDescription = "More", tint = colors.textMuted, modifier = Modifier.size(20.dp))
        }
    }

    if (menuOpen) {
        if (LocalTrackActions.current != null) {
            TrackActionsSheet(
                track = track,
                onDismiss = { menuOpen = false },
                onRemoveFromPlaylist = onRemoveFromPlaylist,
                editIds = editIds,
            )
        } else {
            // Outside the app shell (no shared actions): playlist picker only.
            androidx.compose.material3.DropdownMenu(expanded = true, onDismissRequest = { menuOpen = false }) {
                playlists.forEach { playlist ->
                    androidx.compose.material3.DropdownMenuItem(
                        text = { Text(playlist.name) },
                        onClick = {
                            menuOpen = false
                            onAddToPlaylist(playlist.id)
                        },
                    )
                }
            }
        }
    }
}
