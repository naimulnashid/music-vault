package com.musicvault.ui.player

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Lrc
import com.musicvault.ui.theme.LocalVaultColors

/**
 * Port of LyricsPanel.tsx: synced lyrics auto-scroll with active-line highlight,
 * plain lyrics fallback, and the no-lyrics hint.
 */
@Composable
fun LyricsSheet(playerViewModel: PlayerViewModel) {
    val colors = LocalVaultColors.current
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    val positionMs by playerViewModel.positionMs.collectAsStateWithLifecycle()

    val track = playback.currentTrack
    val synced = remember(track?.id) { track?.lyricsLrc?.let { Lrc.parse(it) } ?: emptyList() }

    Column(modifier = Modifier.fillMaxSize()) {
        SheetHeader("Lyrics")

        when {
            track == null -> Text(
                "Nothing playing.",
                color = colors.textMuted,
                fontSize = 14.sp,
                modifier = Modifier.padding(16.dp),
            )

            synced.isNotEmpty() -> {
                val activeIndex = Lrc.findCurrentLineIndex(synced, positionMs)
                val listState = rememberLazyListState()
                LaunchedEffect(activeIndex) {
                    if (activeIndex >= 0) {
                        listState.animateScrollToItem(index = activeIndex, scrollOffset = -300)
                    }
                }
                LazyColumn(
                    state = listState,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    itemsIndexed(synced) { index, line ->
                        Text(
                            line.text.ifBlank { " " },
                            color = if (index == activeIndex) colors.accent else colors.textMuted,
                            fontSize = 14.sp,
                            fontWeight = if (index == activeIndex) FontWeight.Medium else FontWeight.Normal,
                            modifier = Modifier.padding(vertical = 6.dp),
                        )
                    }
                }
            }

            !track.lyricsText.isNullOrBlank() -> {
                LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    itemsIndexed(track.lyricsText.orEmpty().split('\n')) { _, line ->
                        Text(
                            line.ifBlank { " " },
                            color = colors.textMuted,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(vertical = 2.dp),
                        )
                    }
                }
            }

            else -> Text(
                "No lyrics found. Add a matching .lrc file next to this track and re-import to see synced lyrics.",
                color = colors.textMuted,
                fontSize = 14.sp,
                modifier = Modifier.padding(16.dp),
            )
        }
    }
}
