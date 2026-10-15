package com.musicvault.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import com.musicvault.domain.model.Track

/** The first four distinct covers among [tracks], in order. */
fun mosaicArts(tracks: List<Track>): List<String> = tracks.mapNotNull { it.artworkPath }.distinct().take(4)

/**
 * A playlist cover, as desktop/web Mosaic.tsx draws it: a 2×2 grid of four
 * distinct covers, or the first cover when there are fewer.
 */
@Composable
fun ArtMosaic(arts: List<String>, modifier: Modifier, shape: Shape) {
    if (arts.size < 4) {
        AlbumArt(arts.firstOrNull(), modifier = modifier, shape = shape)
        return
    }
    Column(modifier.clip(shape)) {
        for (row in 0 until 2) {
            Row(Modifier.weight(1f).fillMaxWidth()) {
                for (col in 0 until 2) {
                    AlbumArt(arts[row * 2 + col], modifier = Modifier.weight(1f).fillMaxHeight(), shape = RectangleShape)
                }
            }
        }
    }
}
