package com.musicvault.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.domain.model.Track
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.theme.LocalVaultColors

/**
 * Header for a collection page (album, artist, playlist, smart list): a
 * colour wash from the artwork, the cover, kind label, title, meta line and
 * Play / Shuffle / Download — the phone version of the desktop/web Hero.
 */
@Composable
fun CollectionHeader(
    kind: String,
    title: String,
    tracks: List<Track>,
    playerViewModel: PlayerViewModel,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onSubtitleClick: (() -> Unit)? = null,
    meta: String? = null,
    coverShape: Shape = RoundedCornerShape(14.dp),
    /** Replaces the artwork cover (smart-list tiles, playlist icons). */
    cover: (@Composable (Modifier) -> Unit)? = null,
    extraActions: @Composable () -> Unit = {},
) {
    val colors = LocalVaultColors.current
    val art = tracks.firstOrNull { it.artworkPath != null }?.artworkPath
    val tint = rememberArtworkColor(art)
    val wash by animateColorAsState(
        tint?.let { lerp(colors.bg, it, if (colors.isDark) 0.5f else 0.3f) } ?: colors.bg,
        tween(500),
        label = "headerWash",
    )
    val actions = LocalTrackActions.current
    val download = collectionDownload(tracks, actions)

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(wash, colors.bg)))
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        val coverModifier = Modifier
            .size(220.dp)
            .shadow(24.dp, coverShape)
            .clip(coverShape)
        if (cover != null) cover(coverModifier) else AlbumArt(art, modifier = coverModifier, shape = coverShape)

        Spacer(Modifier.height(20.dp))
        Text(kind.uppercase(), color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
        Text(
            title,
            color = colors.text,
            fontSize = 26.sp,
            fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 30.sp,
            modifier = Modifier.padding(top = 4.dp),
        )
        if (subtitle != null) {
            Text(
                subtitle,
                color = colors.text,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .padding(top = 6.dp)
                    .then(if (onSubtitleClick != null) Modifier.clickable(onClick = onSubtitleClick) else Modifier),
            )
        }
        if (meta != null) {
            Text(meta, color = colors.textMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        }

        Spacer(Modifier.height(18.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            PillButton(
                "Play",
                onClick = {
                    if (playerViewModel.uiState.value.shuffle) playerViewModel.toggleShuffle()
                    playerViewModel.playQueue(tracks, 0)
                },
                icon = Icons.Rounded.PlayArrow,
                primary = true,
                enabled = tracks.isNotEmpty(),
            )
            PillButton(
                "Shuffle",
                onClick = {
                    if (!playerViewModel.uiState.value.shuffle) playerViewModel.toggleShuffle()
                    playerViewModel.playQueue(tracks, tracks.indices.random())
                },
                icon = Icons.Rounded.Shuffle,
                enabled = tracks.isNotEmpty(),
            )
            if (download != null) {
                // Tap: download / cancel while downloading / remove once everything is here.
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(colors.surface2)
                        .clickable {
                            when {
                                download.active.isNotEmpty() -> download.active.forEach { actions!!.cancelDownload(it) }
                                download.allDone -> download.ids.forEach { actions!!.removeDownload(it) }
                                else -> download.missing.forEach { actions!!.download(it) }
                            }
                        },
                ) {
                    when {
                        download.active.isNotEmpty() -> ProgressRing(download.ratio, size = 24.dp)
                        download.allDone -> Icon(Icons.Rounded.Check, "Downloaded. Tap to remove the downloads.", tint = colors.accent, modifier = Modifier.size(22.dp))
                        else -> Icon(Icons.Rounded.Download, "Download all", tint = colors.text, modifier = Modifier.size(22.dp))
                    }
                }
            }
            extraActions()
        }
        if (download != null && (download.active.isNotEmpty() || download.done in 1 until download.ids.size)) {
            val left = download.ids.size - download.done
            Text(
                if (download.active.isNotEmpty()) {
                    "Downloading · ${download.done} of ${download.ids.size} done, $left left · tap to cancel"
                } else {
                    "${download.done} of ${download.ids.size} downloaded"
                },
                color = colors.textMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}

/** A collection's download state, from the shared download badges' data. */
private class CollectionDownload(
    val ids: List<String>,
    val done: Int,
    val active: List<String>,
    val missing: List<String>,
    val ratio: Float,
) {
    val allDone get() = done == ids.size
}

private fun collectionDownload(tracks: List<Track>, actions: TrackActions?): CollectionDownload? {
    if (actions == null) return null
    val ids = tracks.filter { it.storageKey != null }.map { it.id }.distinct()
    if (ids.isEmpty()) return null
    val done = ids.count { it in actions.pinnedIds }
    val active = ids.filter { it !in actions.pinnedIds && it in actions.downloads }
    val missing = ids.filter { it !in actions.pinnedIds && it !in actions.downloads }
    val partial = active.sumOf { (actions.downloads[it] ?: 0f).toDouble() }
    return CollectionDownload(ids, done, active, missing, ((done + partial) / ids.size).toFloat())
}

/** Gradient tile with an icon — cover for smart lists and coverless playlists. */
@Composable
fun IconCover(icon: androidx.compose.ui.graphics.vector.ImageVector, gradient: List<Color>, modifier: Modifier) {
    Box(contentAlignment = Alignment.Center, modifier = modifier.background(Brush.linearGradient(gradient))) {
        Icon(icon, null, tint = Color.White, modifier = Modifier.size(72.dp))
    }
}
