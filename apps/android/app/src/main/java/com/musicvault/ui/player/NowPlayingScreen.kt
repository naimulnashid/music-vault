package com.musicvault.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.Lyrics
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.CleaningServices
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Format
import com.musicvault.domain.Lrc
import com.musicvault.domain.model.RepeatMode
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.TrackActionsSheet
import com.musicvault.ui.components.rememberArtworkColor
import com.musicvault.ui.theme.LocalVaultColors
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Full-screen player. Swipe the artwork left/right to change song, drag the
 * screen down to close it, swipe up for Up next. The background takes its
 * colour from the artwork.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NowPlayingScreen(
    playerViewModel: PlayerViewModel,
    libraryViewModel: LibraryViewModel,
    onCollapse: () -> Unit,
    onOpenPanel: (PanelKey) -> Unit,
) {
    val colors = LocalVaultColors.current
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val positionMs by playerViewModel.positionMs.collectAsStateWithLifecycle()
    val tracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val sleepRemainingMs by playerViewModel.sleepRemainingMs.collectAsStateWithLifecycle()

    val track = playback.currentTrack
    LaunchedEffect(track == null) { if (track == null) onCollapse() }
    if (track == null) return

    val libraryTrack = tracks.firstOrNull { it.id == track.id }
    val isFavorite = libraryTrack?.favorite == true
    var menuOpen by remember { mutableStateOf(false) }

    BackHandler(onBack = onCollapse)

    val syncedLyrics = remember(track.id) { track.lyricsLrc?.let { Lrc.parse(it) } ?: emptyList() }
    val activeLine = if (syncedLyrics.isNotEmpty()) {
        val idx = Lrc.findCurrentLineIndex(syncedLyrics, positionMs)
        if (idx >= 0) syncedLyrics[idx].text else null
    } else null

    // Colour wash from the artwork, eased between songs.
    val artColor = rememberArtworkColor(track.artworkPath)
    val wash by animateColorAsState(
        artColor?.let { lerp(colors.bg, it, if (colors.isDark) 0.55f else 0.35f) } ?: colors.surface2,
        animationSpec = tween(600),
        label = "wash",
    )

    // Drag-down-to-close / drag-up-for-queue on the whole screen.
    val scope = rememberCoroutineScope()
    val dragY = remember { Animatable(0f) }
    val density = LocalDensity.current
    val closeThreshold = with(density) { 140.dp.toPx() }
    val queueThreshold = with(density) { 70.dp.toPx() }
    val currentCollapse by rememberUpdatedState(onCollapse)
    val currentOpenPanel by rememberUpdatedState(onOpenPanel)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .offset { IntOffset(0, dragY.value.coerceAtLeast(0f).roundToInt()) }
            .background(colors.bg)
            .background(Brush.verticalGradient(0f to wash, 0.65f to colors.bg))
            .pointerInput(Unit) {
                var total = 0f
                detectVerticalDragGestures(
                    onDragStart = { total = 0f },
                    onDragEnd = {
                        scope.launch {
                            when {
                                total > closeThreshold -> currentCollapse()
                                total < -queueThreshold -> {
                                    dragY.animateTo(0f, spring())
                                    currentOpenPanel(PanelKey.QUEUE)
                                }
                                else -> dragY.animateTo(0f, spring(dampingRatio = 0.75f))
                            }
                        }
                    },
                    onDragCancel = { scope.launch { dragY.animateTo(0f, spring()) } },
                ) { change, amount ->
                    change.consume()
                    total += amount
                    if (total > 0) scope.launch { dragY.snapTo(total * 0.9f) }
                }
            }
            .systemBarsPadding(),
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                IconButton(onClick = onCollapse) {
                    Icon(Icons.Rounded.ExpandMore, "Close player", tint = colors.text, modifier = Modifier.size(30.dp))
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                    Text("PLAYING FROM YOUR VAULT", color = colors.textMuted, fontSize = 10.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                    Text(
                        track.album.ifBlank { track.artist },
                        color = colors.text,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Rounded.MoreVert, "More", tint = colors.text, modifier = Modifier.size(24.dp))
                }
            }

            // Artwork pager: swipe to change song
            val queue = playback.queue
            val pagerState = rememberPagerState(initialPage = playback.currentIndex.coerceAtLeast(0)) { queue.size }
            val currentIndex by rememberUpdatedState(playback.currentIndex)
            LaunchedEffect(playback.currentIndex, queue.size) {
                val target = playback.currentIndex
                if (target in 0 until queue.size && pagerState.currentPage != target) {
                    if (kotlin.math.abs(pagerState.currentPage - target) > 3) pagerState.scrollToPage(target)
                    else pagerState.animateScrollToPage(target)
                }
            }
            LaunchedEffect(pagerState) {
                snapshotFlow { pagerState.settledPage }.collect { page ->
                    if (page != currentIndex && page in 0 until playerViewModel.uiState.value.queue.size) {
                        playerViewModel.jumpTo(page)
                    }
                }
            }
            BoxWithConstraints(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                // The pager clips its pages: leave room around the art for its shadow.
                val artSize = minOf(maxWidth - 48.dp, maxHeight - 56.dp)
                HorizontalPager(
                    state = pagerState,
                    contentPadding = PaddingValues(horizontal = (maxWidth - artSize) / 2),
                    pageSpacing = 16.dp,
                    key = { page -> queue.getOrNull(page)?.uid ?: page },
                    modifier = Modifier.fillMaxWidth(),
                ) { page ->
                    val entry = queue.getOrNull(page)
                    val isCurrentPage = page == playback.currentIndex
                    val scale by animateFloatAsState(
                        if (isCurrentPage && playback.isPlaying) 1f else if (isCurrentPage) 0.92f else 0.86f,
                        spring(dampingRatio = 0.7f, stiffness = 300f),
                        label = "artScale",
                    )
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 24.dp)) {
                    AlbumArt(
                        entry?.track?.artworkPath,
                        modifier = Modifier
                            .size(artSize)
                            .graphicsLayer {
                                scaleX = scale
                                scaleY = scale
                            }
                            .shadow(20.dp, RoundedCornerShape(16.dp)),
                        shape = RoundedCornerShape(16.dp),
                    )
                    }
                }
            }

            Column(modifier = Modifier.padding(horizontal = 24.dp)) {
                // Title + favorite
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        AnimatedContent(
                            targetState = track.id,
                            transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) },
                            label = "title",
                        ) { _ ->
                            Column {
                                Text(
                                    track.title,
                                    color = colors.text,
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    track.artist,
                                    color = colors.textMuted,
                                    fontSize = 15.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }
                        }
                    }
                    val heartScale = remember { Animatable(1f) }
                    IconButton(onClick = {
                        libraryViewModel.toggleFavorite(track.id)
                        if (!isFavorite) scope.launch {
                            heartScale.animateTo(1.35f, tween(120))
                            heartScale.animateTo(1f, spring(dampingRatio = 0.4f))
                        }
                    }) {
                        Icon(
                            if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                            if (isFavorite) "Remove from favorites" else "Add to favorites",
                            tint = if (isFavorite) colors.accent else colors.text,
                            modifier = Modifier
                                .size(28.dp)
                                .scale(heartScale.value),
                        )
                    }
                }
                if (activeLine?.isNotBlank() == true) {
                    Text(
                        activeLine,
                        color = colors.accent,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }

                Spacer(Modifier.height(18.dp))
                SeekBar(
                    positionMs = positionMs,
                    durationMs = playback.durationMs,
                    onSeek = playerViewModel::seekTo,
                )

                Spacer(Modifier.height(8.dp))
                // Transport
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    IconButton(onClick = playerViewModel::toggleShuffle) {
                        Icon(
                            Icons.Rounded.Shuffle,
                            "Shuffle",
                            tint = if (playback.shuffle) colors.accent else colors.textMuted,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                    IconButton(onClick = playerViewModel::previous, modifier = Modifier.size(56.dp)) {
                        Icon(Icons.Rounded.SkipPrevious, "Previous", tint = colors.text, modifier = Modifier.size(40.dp))
                    }
                    PlayButton(playing = playback.isPlaying, onClick = playerViewModel::togglePlay)
                    IconButton(onClick = playerViewModel::next, modifier = Modifier.size(56.dp)) {
                        Icon(Icons.Rounded.SkipNext, "Next", tint = colors.text, modifier = Modifier.size(40.dp))
                    }
                    IconButton(onClick = playerViewModel::cycleRepeat) {
                        Icon(
                            if (playback.repeat == RepeatMode.ONE) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                            "Repeat: ${playback.repeat.name.lowercase()}",
                            tint = if (playback.repeat != RepeatMode.OFF) colors.accent else colors.textMuted,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))
                // Extras
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    SleepTimerButton(
                        remainingMs = sleepRemainingMs,
                        onStart = playerViewModel::startSleepTimer,
                        onCancel = playerViewModel::cancelSleepTimer,
                    )
                    IconButton(onClick = { onOpenPanel(PanelKey.VISUALIZER) }) {
                        Icon(Icons.Rounded.GraphicEq, "Visualizer", tint = colors.textMuted, modifier = Modifier.size(22.dp))
                    }
                    IconButton(onClick = { onOpenPanel(PanelKey.EQUALIZER) }) {
                        Icon(Icons.Rounded.Tune, "Sound", tint = colors.textMuted, modifier = Modifier.size(22.dp))
                    }
                    IconButton(onClick = playerViewModel::clearQueue) {
                        Icon(Icons.Rounded.CleaningServices, "Clear queue", tint = colors.textMuted, modifier = Modifier.size(22.dp))
                    }
                }
            }

            // Up next / Lyrics strip — tap, or swipe up anywhere.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(colors.text.copy(alpha = 0.06f)),
            ) {
                StripTab(Icons.AutoMirrored.Rounded.QueueMusic, "Up next", Modifier.weight(1f)) { onOpenPanel(PanelKey.QUEUE) }
                StripTab(Icons.Rounded.Lyrics, "Lyrics", Modifier.weight(1f)) { onOpenPanel(PanelKey.LYRICS) }
            }
        }
    }

    if (menuOpen) {
        TrackActionsSheet(track = libraryTrack ?: track, onDismiss = { menuOpen = false })
    }
}

@Composable
private fun StripTab(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    val colors = LocalVaultColors.current
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
    ) {
        Icon(Icons.Rounded.KeyboardArrowUp, null, tint = colors.subtle, modifier = Modifier.size(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = colors.text, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(label.uppercase(), color = colors.text, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        }
    }
}

@Composable
private fun PlayButton(playing: Boolean, onClick: () -> Unit) {
    val colors = LocalVaultColors.current
    val interaction = remember { MutableInteractionSource() }
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(72.dp)
            .shadow(12.dp, CircleShape)
            .clip(CircleShape)
            .background(colors.text)
            .clickable(interactionSource = interaction, indication = androidx.compose.material3.ripple(), onClick = onClick),
    ) {
        AnimatedContent(
            targetState = playing,
            transitionSpec = { (scaleIn(initialScale = 0.5f) + fadeIn()) togetherWith (scaleOut(targetScale = 0.5f) + fadeOut()) },
            label = "bigPlay",
        ) { isPlaying ->
            Icon(
                if (isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                if (isPlaying) "Pause" else "Play",
                tint = colors.bg,
                modifier = Modifier.size(38.dp),
            )
        }
    }
}

/** Thin seek bar: drag or tap; the position freezes under the finger while scrubbing. */
@Composable
fun SeekBar(positionMs: Long, durationMs: Long, onSeek: (Long) -> Unit, modifier: Modifier = Modifier) {
    val colors = LocalVaultColors.current
    var scrub by remember { mutableFloatStateOf(-1f) }
    var widthPx by remember { mutableFloatStateOf(1f) }
    val duration = durationMs.coerceAtLeast(1L)
    val fraction = if (scrub >= 0f) scrub else (positionMs.toFloat() / duration).coerceIn(0f, 1f)
    val thumb by animateFloatAsState(if (scrub >= 0f) 18f else 12f, label = "thumb")
    val track by animateFloatAsState(if (scrub >= 0f) 6f else 4f, label = "track")

    Column(modifier = modifier.fillMaxWidth()) {
        Box(
            contentAlignment = Alignment.CenterStart,
            modifier = Modifier
                .fillMaxWidth()
                .height(28.dp)
                .onSizeChanged { widthPx = it.width.toFloat().coerceAtLeast(1f) }
                .pointerInput(duration) {
                    detectTapGestures { offset -> onSeek(((offset.x / size.width).coerceIn(0f, 1f) * duration).toLong()) }
                }
                .pointerInput(duration) {
                    detectHorizontalDragGestures(
                        onDragStart = { offset -> scrub = (offset.x / size.width).coerceIn(0f, 1f) },
                        onDragEnd = {
                            onSeek((scrub * duration).toLong())
                            scrub = -1f
                        },
                        onDragCancel = { scrub = -1f },
                    ) { change, drag ->
                        change.consume()
                        scrub = (scrub + drag / size.width).coerceIn(0f, 1f)
                    }
                },
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(track.dp)
                    .clip(CircleShape)
                    .background(colors.text.copy(alpha = 0.15f)),
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(track.dp)
                    .clip(CircleShape)
                    .background(colors.accent),
            )
            val thumbOffset = with(LocalDensity.current) { (fraction * widthPx).toDp() - (thumb / 2).dp }
            Box(
                modifier = Modifier
                    .offset(x = thumbOffset)
                    .size(thumb.dp)
                    .shadow(4.dp, CircleShape)
                    .clip(CircleShape)
                    .background(Color.White),
            )
        }
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                Format.formatTime(if (scrub >= 0f) (scrub * duration).toLong() else positionMs),
                color = colors.textMuted,
                fontSize = 12.sp,
                modifier = Modifier.weight(1f),
            )
            Text(Format.formatTime(durationMs), color = colors.textMuted, fontSize = 12.sp)
        }
    }
}
