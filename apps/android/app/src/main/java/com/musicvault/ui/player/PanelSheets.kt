package com.musicvault.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CleaningServices
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DragHandle
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Format
import com.musicvault.ui.LibraryViewModel
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.components.HorizontalBorder
import com.musicvault.ui.theme.LocalVaultColors

enum class PanelKey { QUEUE, EQUALIZER, LYRICS, VISUALIZER }

/** The web app's right-side panels as bottom sheets (App.tsx activePanel). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun PanelSheets(
    activePanel: PanelKey?,
    onDismiss: () -> Unit,
    playerViewModel: PlayerViewModel,
    libraryViewModel: LibraryViewModel,
) {
    if (activePanel == null) return
    val colors = LocalVaultColors.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        contentColor = colors.text,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        Box(modifier = Modifier.fillMaxHeight(0.8f)) {
            when (activePanel) {
                PanelKey.QUEUE -> QueueSheet(playerViewModel)
                PanelKey.EQUALIZER -> EqualizerSheet(playerViewModel)
                PanelKey.LYRICS -> LyricsSheet(playerViewModel)
                PanelKey.VISUALIZER -> VisualizerSheet(playerViewModel)
            }
        }
    }
}

@Composable
fun SheetHeader(title: String, trailing: @Composable () -> Unit = {}) {
    val colors = LocalVaultColors.current
    Column {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 12.dp, top = 2.dp, bottom = 10.dp),
        ) {
            Text(
                title,
                color = colors.text,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            trailing()
        }
        
    }
}

/** Port of QueuePanel.tsx: jump, drag-reorder, remove, clear. */
@Composable
private fun QueueSheet(playerViewModel: PlayerViewModel) {
    val colors = LocalVaultColors.current
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val rowHeight = 64.dp
    val rowHeightPx = with(LocalDensity.current) { rowHeight.toPx() }
    var draggingIndex by remember { mutableIntStateOf(-1) }
    var dragOffset by remember { mutableFloatStateOf(0f) }

    Column(modifier = Modifier.fillMaxSize()) {
        SheetHeader("Up next") {
            if (playback.queue.isNotEmpty()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.clickable { playerViewModel.clearQueue() },
                ) {
                    Icon(
                        Icons.Rounded.CleaningServices,
                        null,
                        tint = colors.textMuted,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.size(4.dp))
                    Text("Clear", color = colors.textMuted, fontSize = 12.sp)
                }
            }
        }

        if (playback.queue.isEmpty()) {
            Text(
                "Queue is empty. Play a track to fill it up.",
                color = colors.textMuted,
                fontSize = 14.sp,
                modifier = Modifier.padding(16.dp),
            )
            return@Column
        }

        LazyColumn(state = rememberLazyListState(), modifier = Modifier.fillMaxSize()) {
            itemsIndexed(playback.queue, key = { _, entry -> entry.uid }) { index, entry ->
                val isCurrent = index == playback.currentIndex
                val isDraggingThis = draggingIndex == index
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .zIndex(if (isDraggingThis) 1f else 0f)
                        .graphicsLayer { translationY = if (isDraggingThis) dragOffset else 0f }
                        .fillMaxWidth()
                        .height(rowHeight)
                        .padding(horizontal = 8.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                        .background(if (isCurrent) colors.accentSoft else Color.Transparent)
                        .clickable {
                            if (isCurrent) playerViewModel.togglePlay() else playerViewModel.jumpTo(index)
                        }
                        .padding(horizontal = 12.dp),
                ) {
                    Icon(
                        Icons.Rounded.DragHandle,
                        "Reorder",
                        tint = colors.textMuted,
                        modifier = Modifier
                            .size(20.dp)
                            .pointerInput(index, playback.queue.size) {
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
                                    while (dragOffset > rowHeightPx / 2 && draggingIndex < playback.queue.size - 1) {
                                        playerViewModel.reorderQueue(draggingIndex, draggingIndex + 1)
                                        draggingIndex += 1
                                        dragOffset -= rowHeightPx
                                    }
                                    while (dragOffset < -rowHeightPx / 2 && draggingIndex > 0) {
                                        playerViewModel.reorderQueue(draggingIndex, draggingIndex - 1)
                                        draggingIndex -= 1
                                        dragOffset += rowHeightPx
                                    }
                                }
                            },
                    )
                    Spacer(Modifier.size(8.dp))
                    Box(modifier = Modifier.size(44.dp)) {
                        AlbumArt(entry.track.artworkPath, modifier = Modifier.fillMaxSize())
                        if (isCurrent) {
                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(Color.Black.copy(alpha = 0.4f)),
                            ) {
                                com.musicvault.ui.components.NowPlayingBars(playback.isPlaying, Color.White, height = 14.dp)
                            }
                        }
                    }
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 10.dp),
                    ) {
                        Text(
                            entry.track.title,
                            color = if (isCurrent) colors.accent else colors.text,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            entry.track.artist,
                            color = colors.textMuted,
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(Format.formatTime(entry.track.durationMs), color = colors.textMuted, fontSize = 12.sp)
                    IconButton(onClick = { playerViewModel.removeFromQueue(index) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Rounded.Close, "Remove from queue", tint = colors.textMuted, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}
