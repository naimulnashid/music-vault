package com.musicvault.ui.components

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.ui.theme.LocalVaultColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Three bouncing bars marking the song that's playing (frozen while paused). */
@Composable
fun NowPlayingBars(playing: Boolean, color: Color, modifier: Modifier = Modifier, height: Dp = 14.dp) {
    val transition = rememberInfiniteTransition(label = "bars")
    val phases = listOf(0, 300, 600).map { delay ->
        transition.animateFloat(
            initialValue = 0.25f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(450, delayMillis = delay, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "bar$delay",
        )
    }
    Canvas(modifier = modifier.size(width = height, height = height)) {
        val barW = size.width / 5f
        phases.forEachIndexed { i, phase ->
            val h = size.height * (if (playing) phase.value else 0.35f + i * 0.15f)
            drawRoundRect(
                color = color,
                topLeft = Offset(i * barW * 2, size.height - h),
                size = Size(barW, h),
                cornerRadius = CornerRadius(barW / 2, barW / 2),
            )
        }
    }
}

/** Circular determinate progress (null = waiting for the size). */
@Composable
fun ProgressRing(progress: Float?, modifier: Modifier = Modifier, size: Dp = 20.dp, stroke: Dp = 2.5.dp) {
    val colors = LocalVaultColors.current
    val animated by animateFloatAsState(progress ?: 0f, tween(300), label = "ring")
    val spin = rememberInfiniteTransition(label = "spin").animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(1000)),
        label = "spinAngle",
    )
    Canvas(modifier = modifier.size(size)) {
        val s = stroke.toPx()
        val inset = s / 2
        val arcSize = Size(this.size.width - s, this.size.height - s)
        drawArc(colors.text.copy(alpha = 0.15f), 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(s))
        if (progress == null) {
            drawArc(colors.accent, spin.value, 80f, false, Offset(inset, inset), arcSize, style = Stroke(s, cap = StrokeCap.Round))
        } else {
            drawArc(colors.accent, -90f, 360f * animated, false, Offset(inset, inset), arcSize, style = Stroke(s, cap = StrokeCap.Round))
        }
    }
}

/** Pill button: the one shape for every text action. */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    enabled: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp),
) {
    val colors = LocalVaultColors.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.96f else 1f, spring(stiffness = 600f), label = "press")
    val bg = if (primary) colors.accent else colors.surface2
    val fg = if (primary) colors.accentFg else colors.text
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .scale(scale)
            .height(44.dp)
            .clip(CircleShape)
            .background(if (enabled) bg else bg.copy(alpha = 0.5f))
            .clickable(interactionSource = interaction, indication = androidx.compose.material3.ripple(), enabled = enabled, onClick = onClick)
            .padding(contentPadding),
    ) {
        if (icon != null) {
            Icon(icon, null, tint = fg, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** Single-choice pill row (sort orders, filters). */
@Composable
fun <T> ChipRow(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    val colors = LocalVaultColors.current
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
    ) {
        options.forEach { (key, label) ->
            val active = key == selected
            val bg by animateColorAsState(if (active) colors.text else colors.surface2, label = "chipBg")
            val fg by animateColorAsState(if (active) colors.bg else colors.text, label = "chipFg")
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .height(34.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(bg)
                    .clickable { onSelect(key) }
                    .padding(horizontal = 14.dp),
            ) {
                Text(label, color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** Big screen title with an optional subtitle and trailing actions. */
@Composable
fun ScreenTitle(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailing: @Composable () -> Unit = {},
) {
    val colors = LocalVaultColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = colors.text, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) {
                Text(subtitle, color = colors.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        trailing()
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 20.dp, bottom = 8.dp),
    ) {
        Text(
            text,
            color = LocalVaultColors.current.text,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f),
        )
        trailing()
    }
}

private val artColorCache = LruCache<String, Int>(128)

/**
 * The artwork's average colour (decoded tiny, off the main thread, cached),
 * used for the colour wash behind the player and collection headers.
 */
@Composable
fun rememberArtworkColor(artworkPath: String?): Color? {
    val color by produceState<Color?>(initialValue = artworkPath?.let { artColorCache.get(it) }?.let { Color(it) }, artworkPath) {
        if (artworkPath == null) {
            value = null
            return@produceState
        }
        artColorCache.get(artworkPath)?.let {
            value = Color(it)
            return@produceState
        }
        value = withContext(Dispatchers.IO) {
            runCatching {
                val file = File(artworkPath)
                if (!file.exists()) return@runCatching null
                val opts = BitmapFactory.Options().apply { inSampleSize = 16 }
                val bmp = BitmapFactory.decodeFile(file.path, opts) ?: return@runCatching null
                val one = android.graphics.Bitmap.createScaledBitmap(bmp, 1, 1, true)
                val argb = one.getPixel(0, 0)
                bmp.recycle()
                artColorCache.put(artworkPath, argb)
                Color(argb)
            }.getOrNull()
        }
    }
    return color
}

/** Thin horizontal line separating sections. */
@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(LocalVaultColors.current.border),
    )
}
