package com.musicvault.ui.screens

import com.musicvault.ui.components.AddSongsSheet
import com.musicvault.ui.components.PillButton
import androidx.compose.material.icons.rounded.Add
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Alignment
import com.musicvault.ui.components.CollectionHeader
import com.musicvault.ui.components.IconCover
import com.musicvault.domain.Format
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.SmartRules
import com.musicvault.domain.SmartRulesEngine
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.ArtMosaic
import com.musicvault.ui.components.mosaicArts
import com.musicvault.ui.components.EmptyMessage
import com.musicvault.ui.components.SmartRulesEditorDialog
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.components.ViewHeader
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Port of PlaylistView.tsx: rename, delete, download, drag-reorder, remove tracks. */
@Composable
fun PlaylistScreen(
    playlistId: String,
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onDeleted: () -> Unit,
    onArtistClick: (String) -> Unit,
) {
    val colors = LocalVaultColors.current
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val allTracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()

    val playlist = playlists.firstOrNull { it.id == playlistId }
    if (playlist == null) {
        EmptyMessage("Playlist not found.")
        return
    }

    val byId = remember(allTracks) { allTracks.associateBy { it.id } }
    val history by libraryViewModel.history.collectAsStateWithLifecycle()
    val pinnedIds by libraryViewModel.pinnedIds.collectAsStateWithLifecycle()
    val downloadingIds by libraryViewModel.downloadingIds.collectAsStateWithLifecycle()

    // Smart playlists compute their tracks from rules; manual ones use trackIds.
    val smartRules = remember(playlist.smartRules) {
        if (playlist.isSmart) playlist.smartRules?.let { SmartRules.parse(it) } ?: SmartRules.empty() else null
    }
    val playlistTracks = remember(playlist, byId, smartRules, history) {
        if (smartRules != null) {
            val inputs = allTracks.map {
                SmartRulesEngine.toInput(it, history.playCounts[it.id] ?: 0, history.lastPlayedAt[it.id])
            }
            SmartRulesEngine.evaluate(smartRules, inputs, System.currentTimeMillis())
                .mapNotNull { byId[it] }
        } else {
            playlist.trackIds.mapNotNull { byId[it] }
        }
    }

    var showRename by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }
    var showRules by remember { mutableStateOf(false) }
    var showAddSongs by remember { mutableStateOf(false) }

    var moreOpen by remember { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxSize()) {
        TrackList(
            tracks = playlistTracks,
            currentTrackId = playback.currentTrack?.id,
            isPlaying = playback.isPlaying,
            playlists = playlists,
            onPlay = { index -> playerViewModel.playQueue(playlistTracks, index) },
            onTogglePlay = playerViewModel::togglePlay,
            onToggleFavorite = libraryViewModel::toggleFavorite,
            onDownload = libraryViewModel::downloadTrack,
            onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
            onArtistClick = onArtistClick,
            // Membership and order are rule-driven on smart playlists.
            onRemoveFromPlaylist = if (playlist.isSmart) {
                null
            } else {
                { trackId -> libraryViewModel.removeTrackFromPlaylist(playlist.id, trackId) }
            },
            draggable = !playlist.isSmart,
            // A manual playlist's empty state (with Add songs) is drawn under the header.
            emptyMessage = if (playlist.isSmart) "No songs match these rules yet." else null,
            header = {
                Column {
                CollectionHeader(
                    kind = if (playlist.isSmart) "Smart playlist" else "Playlist",
                    title = playlist.name,
                    tracks = playlistTracks,
                    playerViewModel = playerViewModel,
                    meta = "${playlistTracks.size} ${if (playlistTracks.size == 1) "song" else "songs"} • ${Format.formatDurationLong(playlistTracks.sumOf { it.durationMs } / 1000)}",
                    cover = if (playlistTracks.none { it.artworkPath != null }) {
                        { m ->
                            IconCover(
                                if (playlist.isSmart) Icons.Rounded.AutoAwesome else Icons.AutoMirrored.Rounded.QueueMusic,
                                if (playlist.isSmart) listOf(Color(0xFF8B5CF6), Color(0xFFC026D3)) else listOf(colors.surface3, colors.textMuted),
                                m,
                            )
                        }
                    } else if (mosaicArts(playlistTracks).size == 4) {
                        { m -> ArtMosaic(mosaicArts(playlistTracks), m, androidx.compose.ui.graphics.RectangleShape) }
                    } else null,
                    extraActions = {
                        androidx.compose.foundation.layout.Box {
                            IconButton(onClick = { moreOpen = true }) {
                                Icon(Icons.Rounded.MoreVert, "More", tint = colors.text)
                            }
                            androidx.compose.material3.DropdownMenu(expanded = moreOpen, onDismissRequest = { moreOpen = false }) {
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text(if (playlist.isSmart) "Edit rules" else "Make it a smart playlist") },
                                    leadingIcon = { Icon(Icons.Rounded.AutoAwesome, null) },
                                    onClick = {
                                        moreOpen = false
                                        showRules = true
                                    },
                                )
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text("Rename") },
                                    leadingIcon = { Icon(Icons.Rounded.Edit, null) },
                                    onClick = {
                                        moreOpen = false
                                        showRename = true
                                    },
                                )
                                androidx.compose.material3.DropdownMenuItem(
                                    text = { Text("Delete playlist", color = colors.danger) },
                                    leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = colors.danger) },
                                    onClick = {
                                        moreOpen = false
                                        showDelete = true
                                    },
                                )
                            }
                        }
                    },
                )
                if (!playlist.isSmart && playlistTracks.isEmpty()) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp),
                    ) {
                        Text("This playlist is empty.", color = colors.textMuted, fontSize = 14.sp)
                        Spacer(Modifier.height(14.dp))
                        PillButton("Add songs", onClick = { showAddSongs = true }, icon = Icons.Rounded.Add, primary = true)
                    }
                }
                }
            },
            onReorder = if (playlist.isSmart) {
                null
            } else {
                { from, to ->
                    val reordered = playlist.trackIds.toMutableList()
                    val moved = reordered.removeAt(from)
                    reordered.add(to, moved)
                    libraryViewModel.reorderPlaylist(playlist.id, reordered)
                }
            },
        )
    }

    if (showAddSongs) {
        AddSongsSheet(
            playlistName = playlist.name,
            inPlaylist = playlist.trackIds.toSet(),
            tracks = allTracks,
            onAdd = { trackId -> libraryViewModel.addTrackToPlaylist(playlist.id, trackId) },
            onDismiss = { showAddSongs = false },
        )
    }

    if (showRules) {
        SmartRulesEditorDialog(
            initial = smartRules ?: SmartRules.empty(),
            onSave = { rules ->
                showRules = false
                libraryViewModel.setSmartRules(playlist.id, rules.encode())
            },
            onDismiss = { showRules = false },
        )
    }

    if (showRename) {
        var name by remember { mutableStateOf(playlist.name) }
        AlertDialog(
            onDismissRequest = { showRename = false },
            title = { Text("Rename playlist") },
            text = {
                OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true)
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (name.trim().isNotEmpty()) libraryViewModel.renamePlaylist(playlist.id, name.trim())
                        showRename = false
                    },
                    enabled = name.trim().isNotEmpty(),
                ) { Text("Rename") }
            },
            dismissButton = { TextButton(onClick = { showRename = false }) { Text("Cancel") } },
        )
    }

    if (showDelete) {
        AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text("Delete playlist?") },
            text = { Text("\"${playlist.name}\" will be removed. Tracks stay in your library.") },
            confirmButton = {
                TextButton(onClick = {
                    showDelete = false
                    libraryViewModel.deletePlaylist(playlist.id)
                    onDeleted()
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text("Cancel") } },
        )
    }
}
