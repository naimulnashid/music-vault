package com.musicvault.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Format
import com.musicvault.ui.DownloadsViewModel
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.ProgressRing
import com.musicvault.ui.components.ScreenTitle
import com.musicvault.ui.components.SectionTitle
import com.musicvault.ui.components.TrackList
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/**
 * Downloads tab: live progress for every song downloading (overall and per
 * song), the songs kept on this device, and the transfer options.
 */
@Composable
fun DownloadsScreen(
    viewModel: DownloadsViewModel,
    playerViewModel: PlayerViewModel,
    libraryViewModel: LibraryViewModel = hiltViewModel(),
) {
    val colors = LocalVaultColors.current
    val downloads by viewModel.downloads.collectAsStateWithLifecycle()
    val active by viewModel.activeDownloads.collectAsStateWithLifecycle()
    val failed by viewModel.failedDownloads.collectAsStateWithLifecycle()
    val wifiOnly by viewModel.wifiOnly.collectAsStateWithLifecycle()
    val chargingOnly by viewModel.chargingOnly.collectAsStateWithLifecycle()
    val autoDownload by viewModel.autoDownload.collectAsStateWithLifecycle()
    val maxCacheBytes by viewModel.maxCacheBytes.collectAsStateWithLifecycle()
    val cacheUsage by viewModel.cacheUsage.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.refreshCacheUsage() }
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()

    val byId = remember(tracks) { tracks.associateBy { it.id } }
    val pinnedTracks = remember(downloads, byId) { downloads.mapNotNull { byId[it.fileId] } }
    val totalBytes = remember(downloads) { downloads.sumOf { it.sizeBytes } }

    TrackList(
        tracks = pinnedTracks,
        currentTrackId = playback.currentTrack?.id,
        isPlaying = playback.isPlaying,
        playlists = playlists,
        onPlay = { index -> playerViewModel.playQueue(pinnedTracks, index) },
        onTogglePlay = playerViewModel::togglePlay,
        onToggleFavorite = libraryViewModel::toggleFavorite,
        onAddToPlaylist = libraryViewModel::addTrackToPlaylist,
        contentPadding = PaddingValues(bottom = 16.dp),
        emptyMessage = null,
        header = {
            Column {
                ScreenTitle(
                    "Downloads",
                    subtitle = "${downloads.size} ${if (downloads.size == 1) "song" else "songs"} on this device • ${Format.formatBytes(totalBytes)}",
                )

                AnimatedVisibility(
                    visible = active.isNotEmpty(),
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut(),
                ) {
                    val known = active.mapNotNull { it.progress }
                    val overall = if (known.isEmpty()) null else known.sum() / active.size
                    Column(
                        modifier = Modifier
                            .padding(horizontal = 16.dp, vertical = 4.dp)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(20.dp))
                            .background(colors.surface)
                            .padding(16.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ProgressRing(overall, size = 44.dp, stroke = 4.dp)
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    "Downloading ${active.size} ${if (active.size == 1) "song" else "songs"}",
                                    color = colors.text,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    when {
                                        overall != null -> "${(overall * 100).toInt()}% done"
                                        wifiOnly -> "Waiting for Wi-Fi (change below)"
                                        else -> "Starting…"
                                    },
                                    color = colors.textMuted,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        active.forEach { item ->
                            val track = byId[item.fileId]
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(vertical = 6.dp),
                            ) {
                                AlbumArt(track?.artworkPath, modifier = Modifier.size(42.dp), shape = RoundedCornerShape(6.dp))
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            track?.title ?: item.title,
                                            color = colors.text,
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.weight(1f),
                                        )
                                        Text(
                                            item.progress?.let { "${(it * 100).toInt()}%" }
                                                ?: if (wifiOnly) "Waiting for Wi-Fi" else if (chargingOnly) "Waiting to charge" else "Starting…",
                                            color = colors.textMuted,
                                            fontSize = 12.sp,
                                        )
                                    }
                                    Spacer(Modifier.height(6.dp))
                                    ProgressLine(item.progress)
                                }
                                IconButton(onClick = { viewModel.cancel(item.fileId) }, modifier = Modifier.size(36.dp)) {
                                    Icon(Icons.Rounded.Close, "Cancel download", tint = colors.textMuted, modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                }

                AnimatedVisibility(
                    visible = failed.isNotEmpty(),
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut(),
                ) {
                    Column(
                        modifier = Modifier
                            .padding(horizontal = 16.dp, vertical = 4.dp)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(20.dp))
                            .background(colors.surface)
                            .padding(16.dp),
                    ) {
                        Text(
                            "Couldn't download ${failed.size} ${if (failed.size == 1) "song" else "songs"}",
                            color = colors.text,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.height(8.dp))
                        failed.forEach { item ->
                            val track = byId[item.fileId]
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(vertical = 6.dp),
                            ) {
                                AlbumArt(track?.artworkPath, modifier = Modifier.size(42.dp), shape = RoundedCornerShape(6.dp))
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        track?.title ?: item.title,
                                        color = colors.text,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        item.reason,
                                        color = colors.textMuted,
                                        fontSize = 12.sp,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                IconButton(onClick = { viewModel.retryDownload(item.fileId) }, modifier = Modifier.size(36.dp)) {
                                    Icon(Icons.Rounded.Refresh, "Retry download", tint = colors.text, modifier = Modifier.size(20.dp))
                                }
                                IconButton(onClick = { viewModel.dismissFailure(item) }, modifier = Modifier.size(36.dp)) {
                                    Icon(Icons.Rounded.Close, "Dismiss", tint = colors.textMuted, modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                }

                Column(
                    modifier = Modifier
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(20.dp))
                        .background(colors.surface)
                        .padding(vertical = 4.dp),
                ) {
                    OptionRow(
                        "Download all songs automatically",
                        "Songs added to your vault download here, and songs deleted from it are removed. No auto-cache is needed while this is on.",
                        autoDownload,
                    ) { viewModel.setAutoDownload(it) }
                    OptionRow("Download on Wi-Fi only", "Saves mobile data", wifiOnly) { viewModel.setWifiOnly(it) }
                    OptionRow("Only while charging", "Saves battery on long downloads", chargingOnly) { viewModel.setChargingOnly(it) }
                }

                if (!autoDownload) {
                    AutoCacheCard(cacheUsage, maxCacheBytes, viewModel::setMaxCacheBytes, viewModel::clearCache)
                }

                if (pinnedTracks.isEmpty() && active.isEmpty() && failed.isEmpty()) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                    ) {
                        Icon(Icons.Rounded.DownloadForOffline, null, tint = colors.subtle, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.height(12.dp))
                        Text("Nothing downloaded yet", color = colors.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Text(
                            "Open a song's ⋮ menu → Download to keep it for offline listening.",
                            color = colors.textMuted,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                } else if (pinnedTracks.isNotEmpty()) {
                    SectionTitle("On this device")
                }
            }
        },
    )
}

/** 0 turns the auto-cache off; 10 GB is the most it may use. */
private val CACHE_CHOICES_GB = listOf(0L, 1L, 2L, 5L, 10L)

@Composable
private fun AutoCacheCard(usage: Long, max: Long, onMax: (Long) -> Unit, onClear: () -> Unit) {
    val colors = LocalVaultColors.current
    Column(
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(colors.surface)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Auto-cache", color = colors.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text(
                    if (max == 0L) "Off" else "${Format.formatBytes(usage)} used of ${Format.formatBytes(max)}",
                    color = colors.textMuted,
                    fontSize = 12.sp,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier
                    .clip(CircleShape)
                    .background(colors.surface2)
                    .clickable(enabled = usage > 0, onClick = onClear)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Icon(Icons.Rounded.DeleteOutline, null, tint = if (usage > 0) colors.text else colors.subtle, modifier = Modifier.size(16.dp))
                Text("Clear cache", color = if (usage > 0) colors.text else colors.subtle, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            CACHE_CHOICES_GB.forEach { gb ->
                val bytes = gb * 1024 * 1024 * 1024
                val selected = bytes == max
                Text(
                    if (gb == 0L) "Off" else "$gb GB",
                    color = if (selected) colors.accentFg else colors.textMuted,
                    fontSize = 13.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (selected) colors.accent else colors.surface2)
                        .clickable { onMax(bytes) }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }
        }
        Text(
            "Songs you play are kept here so they don't download twice; the least recently played leave first when it's full.",
            color = colors.subtle,
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

@Composable
private fun ProgressLine(progress: Float?) {
    val colors = LocalVaultColors.current
    val animated by animateFloatAsState(progress ?: 0f, label = "line")
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(4.dp)
            .clip(CircleShape)
            .background(colors.surface3),
    ) {
        if (progress != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(animated)
                    .height(4.dp)
                    .clip(CircleShape)
                    .background(colors.accent),
            )
        }
    }
}

@Composable
private fun OptionRow(label: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val colors = LocalVaultColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, color = colors.text, fontSize = 15.sp)
            Text(hint, color = colors.subtle, fontSize = 12.sp)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = colors.accent, checkedThumbColor = Color.White),
        )
    }
}
