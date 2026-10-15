package com.musicvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Format
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.SortKey
import com.musicvault.ui.components.ChipRow
import com.musicvault.ui.components.PillButton
import com.musicvault.ui.components.ScreenTitle
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/** Library tab: every song, with Play/Shuffle and sort chips. */
@Composable
fun LibraryScreen(
    libraryViewModel: LibraryViewModel,
    playerViewModel: PlayerViewModel,
    onArtistClick: (String) -> Unit,
    vaultViewModel: com.musicvault.ui.vault.VaultViewModel? = null,
    onUpload: (() -> Unit)? = null,
    onDeleteFromVault: ((List<String>) -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val signedIn = vaultViewModel?.signedIn?.collectAsStateWithLifecycle()?.value ?: false
    val colors = LocalVaultColors.current
    val allTracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val sortKey by libraryViewModel.sortKey.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val totalMs = remember(allTracks) { allTracks.sumOf { it.durationMs } }

    if (allTracks.isEmpty()) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .padding(32.dp),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(84.dp)
                    .clip(RoundedCornerShape(26.dp))
                    .background(colors.accentSoft),
            ) {
                Icon(Icons.AutoMirrored.Rounded.QueueMusic, null, tint = colors.accent, modifier = Modifier.size(40.dp))
            }
            Spacer(Modifier.height(20.dp))
            Text("Your library is empty", color = colors.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(
                if (signedIn) "Upload songs to your vault to start listening." else "Sign in (tap your avatar, top right) to see your vault.",
                color = colors.textMuted,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )
            if (signedIn && onUpload != null) {
                Spacer(Modifier.height(20.dp))
                PillButton("Upload music", onClick = onUpload, icon = Icons.Rounded.CloudUpload, primary = true)
            }
        }
        return
    }

    TrackList(
        tracks = allTracks,
        currentTrackId = playback.currentTrack?.id,
        isPlaying = playback.isPlaying,
        playlists = playlists,
        onPlay = { index -> playerViewModel.playQueue(allTracks, index) },
        onTogglePlay = playerViewModel::togglePlay,
        onToggleFavorite = libraryViewModel::toggleFavorite,
        onDownload = libraryViewModel::downloadTrack,
        onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
        onArtistClick = onArtistClick,
        onEdit = if (signedIn && vaultViewModel != null) vaultViewModel::openEditor else null,
        onDeleteFromVault = if (signedIn) onDeleteFromVault else null,
        contentPadding = contentPadding,
        header = {
            Column {
                ScreenTitle(
                    "Library",
                    subtitle = "${allTracks.size} ${if (allTracks.size == 1) "song" else "songs"} • ${Format.formatDurationLong(totalMs / 1000)}",
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    PillButton(
                        "Play",
                        onClick = {
                            if (playback.shuffle) playerViewModel.toggleShuffle()
                            playerViewModel.playQueue(allTracks, 0)
                        },
                        icon = Icons.Rounded.PlayArrow,
                        primary = true,
                        modifier = Modifier.weight(1f),
                    )
                    PillButton(
                        "Shuffle",
                        onClick = {
                            if (!playback.shuffle) playerViewModel.toggleShuffle()
                            playerViewModel.playQueue(allTracks, allTracks.indices.random())
                        },
                        icon = Icons.Rounded.Shuffle,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(14.dp))
                ChipRow(
                    options = SortKey.entries.map { it to it.label },
                    selected = sortKey,
                    onSelect = { libraryViewModel.sortKey.value = it },
                )
                Spacer(Modifier.height(8.dp))
            }
        },
    )
}

/** Rounded search input (search screen). */
@Composable
fun SearchField(
    value: String,
    modifier: Modifier = Modifier,
    placeholder: String = "Search songs, albums, artists",
    textModifier: Modifier = Modifier,
    onChange: (String) -> Unit,
) {
    val colors = LocalVaultColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .height(46.dp)
            .clip(RoundedCornerShape(23.dp))
            .background(colors.surface2)
            .padding(horizontal = 16.dp),
    ) {
        Icon(Icons.Rounded.Search, null, tint = colors.textMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.size(10.dp))
        Box(modifier = Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text(placeholder, color = colors.subtle, fontSize = 15.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(color = colors.text, fontSize = 15.sp, fontFamily = com.musicvault.ui.theme.Figtree),
                cursorBrush = SolidColor(colors.accent),
                modifier = textModifier.fillMaxWidth(),
            )
        }
    }
}
