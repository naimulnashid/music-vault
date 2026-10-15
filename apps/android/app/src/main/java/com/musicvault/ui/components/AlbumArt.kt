package com.musicvault.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.musicvault.ui.theme.LocalVaultColors
import java.io.File

/** Port of AlbumArt.tsx: artwork image with a music-note placeholder. */
@Composable
fun AlbumArt(
    artworkPath: String?,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(8.dp),
) {
    val colors = LocalVaultColors.current
    Box(
        modifier = modifier
            .clip(shape)
            .background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(colors.surface3, colors.surface2))),
    ) {
        if (artworkPath != null) {
            AsyncImage(
                model = coil.request.ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                    .data(File(artworkPath))
                    .crossfade(220)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(
                imageVector = Icons.Rounded.MusicNote,
                contentDescription = null,
                tint = colors.subtle,
                modifier = Modifier.fillMaxSize(0.4f).align(Alignment.Center),
            )
        }
    }
}
