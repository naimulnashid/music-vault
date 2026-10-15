package com.musicvault.ui.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.rememberArtworkColor
import com.musicvault.ui.theme.LocalVaultColors
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Floating mini player above the bottom navigation. Swipe it left/right to
 * change song, swipe up (or tap) to open the full player. A thin progress
 * line runs along its bottom edge.
 */
@Composable
fun MiniPlayerBar(
    playerViewModel: PlayerViewModel,
    onExpand: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalVaultColors.current
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val positionMs by playerViewModel.positionMs.collectAsStateWithLifecycle()
    val track = playback.currentTrack ?: return

    val scope = rememberCoroutineScope()
    val offsetX = remember { Animatable(0f) }
    val density = LocalDensity.current
    val swipeThreshold = with(density) { 90.dp.toPx() }
    val expandThreshold = with(density) { 40.dp.toPx() }
    val tint = rememberArtworkColor(track.artworkPath)
    val cardColor = tint?.let { lerp(if (colors.isDark) colors.surface2 else colors.surface, it, if (colors.isDark) 0.3f else 0.14f) } ?: colors.surface2

    Box(
        modifier = modifier
            .padding(horizontal = 8.dp)
            .fillMaxWidth()
            .height(64.dp)
            .shadow(16.dp, RoundedCornerShape(14.dp), ambientColor = colors.bg, spotColor = colors.bg)
            .clip(RoundedCornerShape(14.dp))
            .background(cardColor)
            .pointerInput(playback.queue.size) {
                var dragY = 0f
                detectDragGestures(
                    onDragStart = { dragY = 0f },
                    onDragEnd = {
                        val x = offsetX.value
                        scope.launch {
                            when {
                                dragY < -expandThreshold && abs(dragY) > abs(x) -> {
                                    offsetX.animateTo(0f, spring())
                                    onExpand()
                                }
                                x <= -swipeThreshold -> {
                                    offsetX.animateTo(-size.width.toFloat(), tween(160))
                                    playerViewModel.next()
                                    offsetX.snapTo(size.width.toFloat())
                                    offsetX.animateTo(0f, spring(dampingRatio = 0.8f, stiffness = 500f))
                                }
                                x >= swipeThreshold -> {
                                    offsetX.animateTo(size.width.toFloat(), tween(160))
                                    playerViewModel.previous()
                                    offsetX.snapTo(-size.width.toFloat())
                                    offsetX.animateTo(0f, spring(dampingRatio = 0.8f, stiffness = 500f))
                                }
                                else -> offsetX.animateTo(0f, spring(dampingRatio = 0.7f))
                            }
                        }
                    },
                    onDragCancel = { scope.launch { offsetX.animateTo(0f, spring()) } },
                ) { change, drag ->
                    change.consume()
                    dragY += drag.y
                    if (abs(dragY) < expandThreshold) scope.launch { offsetX.snapTo(offsetX.value + drag.x) }
                }
            }
            .clickable(onClick = onExpand),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .height(62.dp)
                .padding(start = 8.dp, end = 4.dp),
        ) {
            // Song info slides with the finger; the buttons stay put.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .weight(1f)
                    .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                    .graphicsLayer { alpha = 1f - (abs(offsetX.value) / (size.width * 1.2f)).coerceIn(0f, 0.8f) },
            ) {
                AlbumArt(track.artworkPath, modifier = Modifier.size(46.dp), shape = RoundedCornerShape(8.dp))
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 12.dp),
                ) {
                    Text(
                        track.title,
                        color = colors.text,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        track.artist,
                        color = colors.textMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            IconButton(onClick = { playerViewModel.togglePlay() }, modifier = Modifier.size(44.dp)) {
                AnimatedContent(
                    targetState = playback.isPlaying,
                    transitionSpec = { (scaleIn(initialScale = 0.6f) + fadeIn()) togetherWith (scaleOut(targetScale = 0.6f) + fadeOut()) },
                    label = "playPause",
                ) { playing ->
                    Icon(
                        if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (playing) "Pause" else "Play",
                        tint = colors.text,
                        modifier = Modifier.size(30.dp),
                    )
                }
            }
            IconButton(onClick = { playerViewModel.next() }, modifier = Modifier.size(44.dp)) {
                Icon(Icons.Rounded.SkipNext, contentDescription = "Next", tint = colors.text, modifier = Modifier.size(28.dp))
            }
        }
        // Progress along the bottom edge
        val fraction = if (playback.durationMs > 0) (positionMs.toFloat() / playback.durationMs).coerceIn(0f, 1f) else 0f
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .height(2.dp)
                .background(colors.text.copy(alpha = 0.12f)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(2.dp)
                    .background(Brush.horizontalGradient(listOf(colors.accent, colors.accent.copy(alpha = 0.8f)))),
            )
        }
    }
}
