package com.musicvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.LibraryAdd
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.People
import androidx.compose.material.icons.rounded.Sell
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Albums
import com.musicvault.domain.SmartKey
import com.musicvault.domain.SmartPlaylists
import com.musicvault.domain.SmartRules
import com.musicvault.domain.SmartRulesEngine
import com.musicvault.domain.model.Playlist
import com.musicvault.domain.model.Track
import com.musicvault.ui.CreatePlaylistDialog
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.ArtMosaic
import com.musicvault.ui.components.mosaicArts
import com.musicvault.ui.components.PillButton
import com.musicvault.ui.components.ScreenTitle
import com.musicvault.ui.components.SectionTitle
import com.musicvault.ui.theme.LocalVaultColors

val SMART_ICONS: Map<SmartKey, ImageVector> = mapOf(
    SmartKey.RECENTLY_ADDED to Icons.Rounded.LibraryAdd,
    SmartKey.RECENTLY_PLAYED to Icons.Rounded.History,
    SmartKey.MOST_PLAYED to Icons.Rounded.LocalFireDepartment,
    SmartKey.FAVORITES to Icons.Rounded.Favorite,
    SmartKey.NEVER_PLAYED to Icons.Rounded.Block,
    SmartKey.GENRE to Icons.Rounded.Sell,
    SmartKey.ARTIST to Icons.Rounded.People,
    SmartKey.YEAR to Icons.Rounded.CalendarMonth,
    SmartKey.LANGUAGE to Icons.Rounded.Language,
)

/** Gradient behind each smart collection's tile (same pairs as desktop/web). */
val SMART_GRADIENTS: Map<SmartKey, List<Color>> = mapOf(
    SmartKey.RECENTLY_ADDED to listOf(Color(0xFF0EA5E9), Color(0xFF4F46E5)),
    SmartKey.RECENTLY_PLAYED to listOf(Color(0xFF8B5CF6), Color(0xFF4338CA)),
    SmartKey.MOST_PLAYED to listOf(Color(0xFFF97316), Color(0xFFE11D48)),
    SmartKey.FAVORITES to listOf(Color(0xFF8B5CF6), Color(0xFFC026D3)),
    SmartKey.NEVER_PLAYED to listOf(Color(0xFF64748B), Color(0xFF334155)),
    SmartKey.GENRE to listOf(Color(0xFF10B981), Color(0xFF0F766E)),
    SmartKey.ARTIST to listOf(Color(0xFFEC4899), Color(0xFF7C3AED)),
    SmartKey.YEAR to listOf(Color(0xFFF59E0B), Color(0xFFC2410C)),
    SmartKey.LANGUAGE to listOf(Color(0xFF06B6D4), Color(0xFF1D4ED8)),
)

/** Collections tab: your playlists, smart playlists and albums. */
@Composable
fun CollectionsScreen(
    libraryViewModel: LibraryViewModel,
    onPlaylistClick: (id: String) -> Unit,
    onSmartClick: (SmartKey) -> Unit,
    onAlbumClick: (key: String) -> Unit,
    contentPadding: PaddingValues,
) {
    val colors = LocalVaultColors.current
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val albums = remember(tracks) { Albums.groupAlbums(tracks) }
    val byId = remember(tracks) { tracks.associateBy { it.id } }
    val history by libraryViewModel.history.collectAsStateWithLifecycle()
    // Covers come from each playlist's songs; a smart playlist's are the ones its rules match.
    val playlistTracks = remember(playlists, tracks, history) {
        val inputs by lazy {
            tracks.map { SmartRulesEngine.toInput(it, history.playCounts[it.id] ?: 0, history.lastPlayedAt[it.id]) }
        }
        val now = System.currentTimeMillis()
        playlists.associate { p ->
            p.id to if (p.isSmart) {
                val rules = p.smartRules?.let { SmartRules.parse(it) } ?: SmartRules.empty()
                SmartRulesEngine.evaluate(rules, inputs, now).mapNotNull { byId[it] }
            } else {
                p.trackIds.mapNotNull { byId[it] }
            }
        }
    }
    var creating by remember { mutableStateOf(false) }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(150.dp),
        contentPadding = contentPadding,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 4.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            ScreenTitle("Collections", subtitle = "${playlists.size} playlists • ${albums.size} albums") {
                PillButton("New", onClick = { creating = true }, icon = Icons.Rounded.Add, contentPadding = PaddingValues(horizontal = 16.dp))
            }
        }

        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                SectionTitle("Smart playlists", modifier = Modifier.padding(top = 0.dp))
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) {
                    items(SmartPlaylists.ALL, key = { it.key.name }) { def ->
                        Column(
                            modifier = Modifier
                                .width(128.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onSmartClick(def.key) },
                        ) {
                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .aspectRatio(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Brush.linearGradient(SMART_GRADIENTS.getValue(def.key))),
                            ) {
                                Icon(SMART_ICONS.getValue(def.key), null, tint = Color.White, modifier = Modifier.size(40.dp))
                            }
                            Text(
                                def.label,
                                color = colors.text,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 8.dp, start = 2.dp),
                            )
                        }
                    }
                }
            }
        }

        if (playlists.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("Your playlists") }
            items(playlists, key = { "p-${it.id}" }) { playlist ->
                PlaylistCard(playlist, playlistTracks[playlist.id].orEmpty()) { onPlaylistClick(playlist.id) }
            }
        }

        item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("Albums") }
        if (albums.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text("Albums appear here as you upload music.", color = colors.textMuted, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 16.dp))
            }
        }
        items(albums, key = { "a-${it.key}" }) { album ->
            Column(
                modifier = Modifier
                    .padding(horizontal = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onAlbumClick(album.key) },
            ) {
                AlbumArt(
                    album.tracks.firstOrNull()?.artworkPath,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f),
                    shape = RoundedCornerShape(12.dp),
                )
                Text(
                    album.album.ifBlank { "Unknown album" },
                    color = colors.text,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text(album.artist, color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }

    if (creating) {
        CreatePlaylistDialog(
            onDismiss = { creating = false },
            onCreate = { name ->
                creating = false
                libraryViewModel.createPlaylist(name) { id -> onPlaylistClick(id) }
            },
        )
    }
}

@Composable
private fun PlaylistCard(playlist: Playlist, tracks: List<Track>, onClick: () -> Unit) {
    val colors = LocalVaultColors.current
    Column(
        modifier = Modifier
            .padding(horizontal = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
    ) {
        val arts = mosaicArts(tracks)
        if (arts.isEmpty()) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        if (playlist.isSmart) Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFFC026D3)))
                        else Brush.linearGradient(listOf(colors.surface3, colors.surface2)),
                    ),
            ) {
                Icon(
                    if (playlist.isSmart) Icons.Rounded.AutoAwesome else Icons.AutoMirrored.Rounded.QueueMusic,
                    null,
                    tint = if (playlist.isSmart) Color.White else colors.textMuted,
                    modifier = Modifier.size(40.dp),
                )
            }
        } else {
            ArtMosaic(arts, modifier = Modifier.fillMaxWidth().aspectRatio(1f), shape = RoundedCornerShape(12.dp))
        }
        Text(
            playlist.name,
            color = colors.text,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Row {
            Text(
                if (playlist.isSmart) "Smart playlist" else "${playlist.trackIds.size} ${if (playlist.trackIds.size == 1) "song" else "songs"}",
                color = colors.textMuted,
                fontSize = 12.sp,
            )
        }
    }
}
