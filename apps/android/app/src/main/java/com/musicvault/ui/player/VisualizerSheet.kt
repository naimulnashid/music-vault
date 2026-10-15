package com.musicvault.ui.player

import android.Manifest
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.automirrored.rounded.ShowChart
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.ui.theme.LocalVaultColors
import timber.log.Timber
import kotlin.math.hypot

private enum class VisualizerMode { SPECTRUM, WAVEFORM }

/**
 * Port of Visualizer.tsx (spectrum bars / waveform line) on the platform
 * Visualizer effect. Android requires the RECORD_AUDIO permission to tap audio
 * output — nothing is recorded; the OS just gates output capture behind it.
 */
@Composable
fun VisualizerSheet(playerViewModel: PlayerViewModel) {
    val colors = LocalVaultColors.current
    val context = LocalContext.current
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()

    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasPermission = granted }

    var mode by remember { mutableStateOf(VisualizerMode.SPECTRUM) }

    Column(modifier = Modifier.fillMaxSize()) {
        SheetHeader("Visualizer") {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(colors.surface2)
                    .padding(2.dp),
            ) {
                IconButton(
                    onClick = { mode = VisualizerMode.SPECTRUM },
                    modifier = Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (mode == VisualizerMode.SPECTRUM) colors.accent else colors.surface2),
                ) {
                    Icon(
                        Icons.Rounded.GraphicEq,
                        "Spectrum",
                        tint = if (mode == VisualizerMode.SPECTRUM) colors.accentFg else colors.textMuted,
                        modifier = Modifier.size(16.dp),
                    )
                }
                IconButton(
                    onClick = { mode = VisualizerMode.WAVEFORM },
                    modifier = Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (mode == VisualizerMode.WAVEFORM) colors.accent else colors.surface2),
                ) {
                    Icon(
                        Icons.AutoMirrored.Rounded.ShowChart,
                        "Waveform",
                        tint = if (mode == VisualizerMode.WAVEFORM) colors.accentFg else colors.textMuted,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }

        if (!hasPermission) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
            ) {
                Text(
                    "Android needs the microphone permission to visualize audio output. Nothing is recorded.",
                    color = colors.textMuted,
                    fontSize = 14.sp,
                )
                TextButton(onClick = { permissionLauncher.launch(Manifest.permission.RECORD_AUDIO) }) {
                    Text("Allow", color = colors.accent)
                }
            }
            return@Column
        }

        // Capture state, redrawn every frame the Visualizer delivers data.
        var frameTick by remember { mutableIntStateOf(0) }
        val waveform = remember { ByteArray(0).let { arrayOf(ByteArray(1024)) } }
        val fft = remember { arrayOf(ByteArray(1024)) }

        DisposableEffect(playerViewModel.audioSessionId) {
            var visualizer: Visualizer? = null
            try {
                visualizer = Visualizer(playerViewModel.audioSessionId).apply {
                    captureSize = Visualizer.getCaptureSizeRange()[1].coerceAtMost(1024)
                    setDataCaptureListener(
                        object : Visualizer.OnDataCaptureListener {
                            override fun onWaveFormDataCapture(v: Visualizer?, data: ByteArray?, rate: Int) {
                                if (data != null) {
                                    waveform[0] = data.copyOf()
                                    frameTick++
                                }
                            }

                            override fun onFftDataCapture(v: Visualizer?, data: ByteArray?, rate: Int) {
                                if (data != null) {
                                    fft[0] = data.copyOf()
                                    frameTick++
                                }
                            }
                        },
                        Visualizer.getMaxCaptureRate() / 2,
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

        Canvas(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            @Suppress("UNUSED_EXPRESSION")
            frameTick // read so Compose redraws on new capture data

            if (mode == VisualizerMode.SPECTRUM) {
                val data = fft[0]
                if (data.size < 4) return@Canvas
                val barCount = 48
                val gap = 2.dp.toPx()
                val barWidth = (size.width - gap * (barCount - 1)) / barCount
                val bins = data.size / 2 - 1
                val step = (bins / barCount).coerceAtLeast(1)
                for (i in 0 until barCount) {
                    val binIndex = 2 + i * step * 2
                    if (binIndex + 1 >= data.size) break
                    val real = data[binIndex].toFloat()
                    val imaginary = data[binIndex + 1].toFloat()
                    val magnitude = (hypot(real, imaginary) / 128f).coerceIn(0f, 1f)
                    val barHeight = (magnitude * size.height).coerceAtLeast(2.dp.toPx())
                    drawRect(
                        color = colors.accent.copy(alpha = 0.35f + magnitude * 0.65f),
                        topLeft = Offset(i * (barWidth + gap), size.height - barHeight),
                        size = androidx.compose.ui.geometry.Size(barWidth, barHeight),
                    )
                }
            } else {
                val data = waveform[0]
                if (data.size < 2) return@Canvas
                val path = Path()
                val sliceWidth = size.width / data.size
                data.forEachIndexed { i, byte ->
                    val v = ((byte.toInt() and 0xFF) / 128f) - 1f
                    val y = size.height / 2 + v * (size.height / 2) * 0.9f
                    if (i == 0) path.moveTo(0f, y) else path.lineTo(i * sliceWidth, y)
                }
                drawPath(path, color = colors.accent, style = Stroke(width = 2.dp.toPx()))
            }
        }

        Text(
            if (playback.isPlaying) "Reacts to whatever is playing."
            else "Reacts to whatever is playing. Play a track to see it move.",
            color = colors.textMuted,
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}
