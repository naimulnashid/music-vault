package com.musicvault.ui.player

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ShowChart
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Waves
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.musicvault.ui.theme.LocalVaultColors
import timber.log.Timber
import kotlin.math.PI
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Desktop/web lib/vizRender.ts: bars, wave and flow. */
enum class VisualizerMode { BARS, WAVE, FLOW }

private const val PREFS = "player_ui"
private const val MODE_KEY = "vizMode"

fun loadVisualizerMode(context: Context): VisualizerMode =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(MODE_KEY, null)
        ?.let { name -> VisualizerMode.entries.firstOrNull { it.name == name } } ?: VisualizerMode.BARS

fun saveVisualizerMode(context: Context, mode: VisualizerMode) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(MODE_KEY, mode.name).apply()
}

/** A capture older than this counts as silence (paused, or the effect stopped sending). */
private const val STALE_NS = 300_000_000L
private const val FLOW_STEP_NS = 50_000_000L

/**
 * Smoothing state between captures. The platform Visualizer delivers ~20
 * captures a second; drawing runs every display frame and eases toward the
 * latest one, so motion stays fluid instead of stepping.
 */
private class VizState {
    @Volatile var fft = ByteArray(0)
    @Volatile var wave = ByteArray(0)
    @Volatile var capturedAt = 0L

    var bars = FloatArray(0)
    var peaks = FloatArray(0)
    var peakVel = FloatArray(0)
    var waveLine = FloatArray(0)
    val flow = ArrayDeque<Float>()
    var flowLevel = 0f
    var lastFlowPush = 0L
}

/**
 * The visualizer drawn in the full player's cover space. Android gates audio
 * output capture behind RECORD_AUDIO; nothing is recorded.
 */
@Composable
fun VisualizerView(
    audioSessionId: Int,
    mode: VisualizerMode,
    onModeChange: (VisualizerMode) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalVaultColors.current
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasPermission = granted }

    Box(modifier = modifier) {
        if (!hasPermission) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                Text(
                    "Android needs the microphone permission to visualize what's playing. Nothing is recorded.",
                    color = colors.textMuted,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                )
                TextButton(onClick = { permissionLauncher.launch(Manifest.permission.RECORD_AUDIO) }) {
                    Text("Allow", color = colors.accent)
                }
            }
            return@Box
        }

        val state = remember { VizState() }
        var frameNanos by remember { mutableLongStateOf(0L) }
        LaunchedEffect(Unit) {
            while (true) withFrameNanos { frameNanos = it }
        }

        DisposableEffect(audioSessionId) {
            var visualizer: Visualizer? = null
            try {
                visualizer = Visualizer(audioSessionId).apply {
                    captureSize = Visualizer.getCaptureSizeRange()[1].coerceAtMost(1024)
                    setDataCaptureListener(
                        object : Visualizer.OnDataCaptureListener {
                            override fun onWaveFormDataCapture(v: Visualizer?, data: ByteArray?, rate: Int) {
                                if (data != null) {
                                    state.wave = data.copyOf()
                                    state.capturedAt = System.nanoTime()
                                }
                            }

                            override fun onFftDataCapture(v: Visualizer?, data: ByteArray?, rate: Int) {
                                if (data != null) state.fft = data.copyOf()
                            }
                        },
                        Visualizer.getMaxCaptureRate(),
                        true,
                        true,
                    )
                    enabled = true
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to start Visualizer")
            }
            onDispose {
                try {
                    visualizer?.enabled = false
                    visualizer?.release()
                } catch (e: Exception) {
                    Timber.w(e, "Failed to release Visualizer")
                }
            }
        }

        val accent = colors.accent
        val fg = colors.text
        Canvas(modifier = Modifier.fillMaxSize().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 56.dp)) {
            val now = frameNanos // read so Compose redraws every frame
            val live = System.nanoTime() - state.capturedAt < STALE_NS
            when (mode) {
                VisualizerMode.BARS -> drawBars(state, live, accent, fg)
                VisualizerMode.WAVE -> drawWave(state, live, accent, fg)
                VisualizerMode.FLOW -> drawFlow(state, live, now, accent, fg)
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 12.dp)
                .clip(CircleShape)
                .background(colors.surface2.copy(alpha = 0.85f))
                .padding(2.dp),
        ) {
            listOf(
                Triple(VisualizerMode.BARS, Icons.Rounded.GraphicEq, "Bars"),
                Triple(VisualizerMode.WAVE, Icons.AutoMirrored.Rounded.ShowChart, "Wave"),
                Triple(VisualizerMode.FLOW, Icons.Rounded.Waves, "Flow"),
            ).forEach { (key, icon, label) ->
                val on = mode == key
                IconButton(
                    onClick = { onModeChange(key) },
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(if (on) colors.accent else Color.Transparent),
                ) {
                    Icon(icon, label, tint = if (on) colors.accentFg else colors.textMuted, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

/** FFT bytes are (re, im) pairs after DC and Nyquist; a bin's level on a 60 dB scale. */
private fun fftLevel(fft: ByteArray, pos: Float): Float {
    val bins = fft.size / 2 - 1
    if (bins < 2) return 0f
    fun level(k: Int): Float {
        val i = k.coerceIn(1, bins)
        val mag = hypot(fft[2 * i].toFloat(), fft[2 * i + 1].toFloat())
        val db = 20f * log10((mag / 128f).coerceAtLeast(1e-4f))
        return ((db + 60f) / 60f).coerceIn(0f, 1f)
    }
    val k = pos.toInt()
    val f = pos - k
    return level(k) + (level(k + 1) - level(k)) * f
}

private fun DrawScope.drawBars(state: VizState, live: Boolean, accent: Color, fg: Color) {
    val count = (size.width / 9.dp.toPx()).toInt().coerceIn(20, 72)
    if (state.bars.size != count) {
        state.bars = FloatArray(count)
        state.peaks = FloatArray(count)
        state.peakVel = FloatArray(count)
    }
    val fft = state.fft
    val bins = (fft.size / 2 - 1).coerceAtLeast(2)
    // Log-spaced over the musical range (about 40 Hz to 11 kHz at 512 bins).
    val lo = 1f
    val hi = (bins * 0.5f).coerceAtLeast(2f)
    for (i in 0 until count) {
        val t = i / (count - 1f)
        val pos = lo * (hi / lo).pow(t)
        val target = if (live) fftLevel(fft, pos).pow(1.6f) else 0f
        val cur = state.bars[i]
        state.bars[i] = if (target > cur) cur + (target - cur) * 0.55f else cur + (target - cur) * 0.08f
        if (state.bars[i] >= state.peaks[i]) {
            state.peaks[i] = state.bars[i]
            state.peakVel[i] = 0f
        } else {
            state.peakVel[i] += 0.0009f
            state.peaks[i] = (state.peaks[i] - state.peakVel[i]).coerceAtLeast(state.bars[i])
        }
    }
    val gap = 3.dp.toPx()
    val barW = (size.width - gap * (count - 1)) / count
    val base = size.height * 0.8f
    val maxH = base - 4f
    val brush = Brush.verticalGradient(0f to fg, 0.35f to accent, 1f to accent, startY = base - maxH, endY = base)
    val radius = CornerRadius(minOf(barW / 2, 4.dp.toPx()))
    for (i in 0 until count) {
        val x = i * (barW + gap)
        val h = (state.bars[i] * maxH).coerceAtLeast(3f)
        drawRoundRect(brush, Offset(x, base - h), Size(barW, h), radius, alpha = 0.55f + state.bars[i] * 0.45f)
        drawRect(accent, Offset(x, base + 3f), Size(barW, minOf(size.height - base - 3f, h * 0.35f)), alpha = 0.12f)
        if (state.peaks[i] > 0.02f) {
            drawRect(fg, Offset(x, base - state.peaks[i] * maxH - 5.dp.toPx()), Size(barW, 2.dp.toPx()), alpha = 0.9f)
        }
    }
}

private fun DrawScope.drawWave(state: VizState, live: Boolean, accent: Color, fg: Color) {
    val points = (size.width / 6.dp.toPx()).toInt().coerceIn(40, 120)
    if (state.waveLine.size != points) state.waveLine = FloatArray(points)
    val src = state.wave
    if (src.size >= 4) {
        // Start on a rising zero crossing so successive captures line up.
        var start = 0
        for (i in 1 until src.size / 2) {
            val a = (src[i - 1].toInt() and 0xFF)
            val b = (src[i].toInt() and 0xFF)
            if (a < 128 && b >= 128) {
                start = i
                break
            }
        }
        val span = src.size / 2
        for (p in 0 until points) {
            val idx = start + (p / (points - 1f) * (span - 1)).toInt()
            val target = if (live) ((src[idx].toInt() and 0xFF) - 128) / 128f else 0f
            state.waveLine[p] += (target - state.waveLine[p]) * 0.22f
        }
    } else {
        for (p in 0 until points) state.waveLine[p] *= 0.9f
    }
    val mid = size.height / 2
    val amp = size.height * 0.42f
    fun y(p: Int): Float = mid + state.waveLine[p] * amp * sin(PI * p / (points - 1)).toFloat()
    val step = size.width / (points - 1)
    val path = Path().apply {
        moveTo(0f, y(0))
        for (p in 1 until points - 1) {
            quadraticTo(p * step, y(p), p * step + step / 2, (y(p) + y(p + 1)) / 2)
        }
        lineTo(size.width, y(points - 1))
    }
    drawRect(fg, Offset(0f, mid - 0.5f), Size(size.width, 1f), alpha = 0.18f)
    drawPath(path, accent, alpha = 0.2f, style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(path, accent, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
}

private fun DrawScope.drawFlow(state: VizState, live: Boolean, now: Long, accent: Color, fg: Color) {
    val src = state.wave
    var sum = 0f
    for (b in src) {
        val v = ((b.toInt() and 0xFF) - 128) / 128f
        sum += v * v
    }
    val rms = if (live && src.isNotEmpty()) (sqrt(sum / src.size) * 2.6f).coerceAtMost(1f) else 0f
    state.flowLevel += (rms - state.flowLevel) * 0.3f

    val colW = 4.dp.toPx()
    val gap = 2.dp.toPx()
    val capacity = (size.width / (colW + gap)).toInt() + 1
    // Columns follow the clock, not the frame rate: a dropped frame adds the columns it missed.
    if (now - state.lastFlowPush > FLOW_STEP_NS * capacity) state.lastFlowPush = now - FLOW_STEP_NS
    while (now - state.lastFlowPush >= FLOW_STEP_NS) {
        state.lastFlowPush += FLOW_STEP_NS
        state.flow.addLast(state.flowLevel)
    }
    while (state.flow.size > capacity) state.flow.removeFirst()
    val mid = size.height / 2
    val maxH = size.height * 0.46f
    val n = state.flow.size
    state.flow.forEachIndexed { k, level ->
        val age = n - 1 - k
        val x = size.width - colW - age * (colW + gap)
        if (x + colW < 0) return@forEachIndexed
        val h = (level * maxH).coerceAtLeast(2f)
        drawRoundRect(
            if (level > 0.75f) fg else accent,
            Offset(x, mid - h),
            Size(colW, h * 2),
            CornerRadius(2.dp.toPx()),
            alpha = 0.25f + 0.75f * (1f - age / capacity.toFloat()),
        )
    }
}
