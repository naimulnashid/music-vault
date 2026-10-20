package com.musicvault.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.model.Eq
import com.musicvault.ui.theme.LocalVaultColors

/** Port of EqualizerPanel.tsx: preset picker, 10 vertical sliders, gapless + crossfade. */
@OptIn(ExperimentalMaterial3Api::class) // Slider with a custom thumb
@Composable
fun EqualizerSheet(playerViewModel: PlayerViewModel) {
    val colors = LocalVaultColors.current
    val settings by playerViewModel.settings.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        SheetHeader("Sound")

        // Preset selector
        var presetMenuOpen by remember { mutableStateOf(false) }
        Box(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(colors.surface2)
                    .clickable { presetMenuOpen = true }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                Text(settings.eqPreset, color = colors.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Icon(Icons.Rounded.ArrowDropDown, null, tint = colors.textMuted)
            }
            DropdownMenu(expanded = presetMenuOpen, onDismissRequest = { presetMenuOpen = false }) {
                (Eq.PRESETS.keys + if (settings.eqPreset == Eq.CUSTOM) listOf(Eq.CUSTOM) else emptyList()).forEach { name ->
                    DropdownMenuItem(
                        text = { Text(name) },
                        onClick = {
                            presetMenuOpen = false
                            playerViewModel.setEqPreset(name)
                        },
                    )
                }
            }
        }

        // 10 vertical band sliders
        Row(
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .height(220.dp),
        ) {
            Eq.FREQS.forEachIndexed { index, freq ->
                val gain = settings.eqBands.getOrElse(index) { 0f }
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("${gain.toInt()}", color = colors.textMuted, fontSize = 10.sp)
                    val interactionSource = remember { MutableInteractionSource() }
                    val sliderColors = SliderDefaults.colors(
                        thumbColor = colors.accent,
                        activeTrackColor = colors.accent,
                        inactiveTrackColor = colors.surface2,
                    )
                    Slider(
                        value = gain,
                        onValueChange = { value ->
                            val bands = settings.eqBands.toMutableList()
                            while (bands.size < Eq.FREQS.size) bands.add(0f)
                            bands[index] = value
                            playerViewModel.setEqBands(bands)
                        },
                        valueRange = -Eq.MAX_GAIN_DB..Eq.MAX_GAIN_DB,
                        colors = sliderColors,
                        interactionSource = interactionSource,
                        // The default handle is 44dp across, wider than a band, so neighbours would touch.
                        thumb = {
                            SliderDefaults.Thumb(
                                interactionSource = interactionSource,
                                colors = sliderColors,
                                thumbSize = DpSize(4.dp, 24.dp),
                            )
                        },
                        modifier = Modifier
                            .weight(1f)
                            .vertical(),
                    )
                    Text(formatFreq(freq), color = colors.textMuted, fontSize = 10.sp)
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        androidx.compose.material3.HorizontalDivider(color = colors.border)

        Column(modifier = Modifier.padding(16.dp)) {
            Text("PLAYBACK", color = colors.textMuted, fontSize = 11.sp, letterSpacing = 1.sp)
            Spacer(Modifier.height(12.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { playerViewModel.setGapless(!settings.gapless) },
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Gapless", color = colors.text, fontSize = 14.sp)
                    Text(
                        "Preload the next track for seamless transitions",
                        color = colors.textMuted,
                        fontSize = 12.sp,
                    )
                }
                Checkbox(
                    checked = settings.gapless,
                    onCheckedChange = { playerViewModel.setGapless(it) },
                    colors = CheckboxDefaults.colors(checkedColor = colors.accent),
                )
            }

            Spacer(Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                Text("Crossfade", color = colors.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Text(
                    if (settings.crossfadeSeconds == 0) "Off" else "${settings.crossfadeSeconds}s",
                    color = colors.textMuted,
                    fontSize = 14.sp,
                )
            }
            Slider(
                value = settings.crossfadeSeconds.toFloat(),
                onValueChange = { playerViewModel.setCrossfadeSeconds(it.toInt()) },
                valueRange = 0f..12f,
                steps = 11,
                colors = SliderDefaults.colors(
                    thumbColor = colors.accent,
                    activeTrackColor = colors.accent,
                    inactiveTrackColor = colors.surface2,
                ),
            )
            Text(
                "Overlap and fade between tracks. Overrides gapless when above 0.",
                color = colors.textMuted,
                fontSize = 12.sp,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * Turns a horizontal slider upright, minimum at the bottom. Rotating alone
 * leaves the layout bounds horizontal, so the bands would overlap; this
 * measures the slider with width and height swapped, then rotates it into
 * the space it reported.
 */
private fun Modifier.vertical(): Modifier = this
    .graphicsLayer {
        rotationZ = 270f
        transformOrigin = TransformOrigin(0f, 0f)
    }
    .layout { measurable, constraints ->
        val placeable = measurable.measure(
            Constraints(
                minWidth = constraints.minHeight,
                maxWidth = constraints.maxHeight,
                minHeight = constraints.minWidth,
                maxHeight = constraints.maxWidth,
            ),
        )
        layout(placeable.height, placeable.width) { placeable.place(-placeable.width, 0) }
    }

private fun formatFreq(freq: Int): String = if (freq >= 1000) "${freq / 1000}k" else "$freq"
