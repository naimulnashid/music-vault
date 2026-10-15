package com.musicvault.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.VolumeDown
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.musicvault.ui.theme.LocalVaultColors
import kotlin.math.roundToInt

/**
 * Speaker button for the full player. A tap opens a vertical slider above it;
 * dragging (or tapping) the track sets the player volume, and the percentage
 * shows while you drag. The volume is the app's own, as on desktop and web,
 * not the phone's media volume.
 */
@Composable
fun VolumeButton(volume: Float, onVolume: (Float) -> Unit) {
    val colors = LocalVaultColors.current
    var open by remember { mutableStateOf(false) }

    Box {
        IconButton(onClick = { open = true }) {
            Icon(
                when {
                    volume <= 0f -> Icons.AutoMirrored.Rounded.VolumeOff
                    volume < 0.5f -> Icons.AutoMirrored.Rounded.VolumeDown
                    else -> Icons.AutoMirrored.Rounded.VolumeUp
                },
                "Volume",
                tint = if (open) colors.accent else colors.textMuted,
                modifier = Modifier.size(22.dp),
            )
        }
        if (open) {
            Popup(
                popupPositionProvider = AboveAnchor,
                onDismissRequest = { open = false },
                properties = PopupProperties(focusable = true),
            ) {
                VerticalVolumeSlider(volume, onVolume)
            }
        }
    }
}

@Composable
private fun VerticalVolumeSlider(volume: Float, onVolume: (Float) -> Unit) {
    val colors = LocalVaultColors.current
    var dragging by remember { mutableStateOf(false) }
    val trackHeight = 180.dp

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .shadow(12.dp, RoundedCornerShape(22.dp))
            .clip(RoundedCornerShape(22.dp))
            .background(colors.surface)
            .border(1.dp, colors.border, RoundedCornerShape(22.dp))
            .padding(horizontal = 12.dp, vertical = 14.dp),
    ) {
        Text(
            "${(volume * 100).roundToInt()}%",
            color = if (dragging) colors.accent else colors.text,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.width(44.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Box(
            contentAlignment = Alignment.BottomCenter,
            modifier = Modifier
                .width(40.dp)
                .height(trackHeight)
                .clip(RoundedCornerShape(14.dp))
                .background(colors.surface3)
                // Press anywhere on the track to jump there, then drag; top is 100 %.
                .pointerInput(Unit) {
                    fun fractionAt(y: Float) = (1f - y / size.height).coerceIn(0f, 1f)
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        dragging = true
                        onVolume(fractionAt(down.position.y))
                        do {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull() ?: break
                            if (change.positionChange().y != 0f) onVolume(fractionAt(change.position.y))
                            change.consume()
                        } while (change.pressed)
                        dragging = false
                    }
                },
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(volume.coerceIn(0f, 1f))
                    .background(colors.accent),
            )
        }
    }
}

/** Centres the popup above its anchor, kept inside the window. */
private object AboveAnchor : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val x = (anchorBounds.center.x - popupContentSize.width / 2)
            .coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0))
        val y = (anchorBounds.top - popupContentSize.height - 16).coerceAtLeast(0)
        return IntOffset(x, y)
    }
}
