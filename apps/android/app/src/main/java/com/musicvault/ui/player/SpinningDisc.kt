package com.musicvault.ui.player

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.musicvault.ui.components.AlbumArt
import com.musicvault.ui.theme.LocalVaultColors

private const val PREFS = "player_ui"
private const val DISC_KEY = "spinningDisc"

fun loadSpinningDisc(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(DISC_KEY, false)

fun saveSpinningDisc(context: Context, on: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(DISC_KEY, on).apply()
}

/**
 * The cover as the label of a record that turns while the song plays and
 * stops where it is on pause (desktop/web SpinningDisc.tsx). The light on the
 * vinyl stays put while the record turns under it.
 */
@Composable
fun SpinningDisc(artworkPath: String?, playing: Boolean, modifier: Modifier = Modifier) {
    val colors = LocalVaultColors.current
    val rotation = remember { Animatable(0f) }
    LaunchedEffect(playing) {
        if (!playing) return@LaunchedEffect
        while (true) {
            rotation.snapTo(rotation.value % 360f)
            rotation.animateTo(rotation.value + 360f, tween(5000, easing = LinearEasing))
        }
    }
    Box(contentAlignment = Alignment.Center, modifier = modifier.shadow(20.dp, CircleShape)) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { rotationZ = rotation.value },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val r = size.minDimension / 2
                drawCircle(Color(0xFF0D0D10), r)
                // Grooves.
                var gr = r * 0.97f
                while (gr > r * 0.27f) {
                    drawCircle(Color.White.copy(alpha = 0.045f), gr, style = Stroke(width = 1f))
                    gr -= 3.dp.toPx()
                }
                drawCircle(Color(0xFF26262C), r * 0.25f)
            }
            AlbumArt(
                artworkPath,
                modifier = Modifier.fillMaxWidth(0.5f).aspectRatio(1f),
                shape = CircleShape,
            )
            Canvas(Modifier.fillMaxSize()) {
                drawCircle(colors.bg, size.minDimension * 0.0175f)
            }
        }
        // Fixed sheen over the turning record.
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2
            drawCircle(
                Brush.sweepGradient(
                    0f to Color.Transparent,
                    0.08f to Color.White.copy(alpha = 0.12f),
                    0.17f to Color.Transparent,
                    0.5f to Color.Transparent,
                    0.58f to Color.White.copy(alpha = 0.07f),
                    0.67f to Color.Transparent,
                    1f to Color.Transparent,
                ),
                r * 0.62f,
                style = Stroke(width = r * 0.7f),
                center = center,
                alpha = 1f,
            )
        }
    }
}
