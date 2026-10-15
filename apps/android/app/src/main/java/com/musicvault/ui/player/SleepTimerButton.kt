package com.musicvault.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.ui.theme.LocalVaultColors

private val OPTIONS = listOf(15, 30, 45, 60)

/** Port of SleepTimer.tsx: moon button + 15/30/45/60 menu + live countdown. */
@Composable
fun SleepTimerButton(
    remainingMs: Long?,
    onStart: (minutes: Int) -> Unit,
    onCancel: () -> Unit,
) {
    val colors = LocalVaultColors.current
    var open by remember { mutableStateOf(false) }
    val active = remainingMs != null

    Box {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            IconButton(onClick = { open = true }, modifier = Modifier.size(if (active) 32.dp else 40.dp)) {
                Icon(
                    Icons.Rounded.Bedtime,
                    "Sleep timer",
                    tint = if (active) colors.accent else colors.textMuted,
                    modifier = Modifier.size(20.dp),
                )
            }
            if (remainingMs != null) {
                Text(formatRemaining(remainingMs), color = colors.accent, fontSize = 10.sp)
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("SLEEP IN", color = colors.textMuted, fontSize = 11.sp, letterSpacing = 1.sp) },
                onClick = {},
                enabled = false,
            )
            OPTIONS.forEach { minutes ->
                DropdownMenuItem(
                    text = { Text("$minutes minutes") },
                    onClick = {
                        open = false
                        onStart(minutes)
                    },
                )
            }
            if (active) {
                DropdownMenuItem(
                    text = { Text("Cancel timer", color = androidx.compose.ui.graphics.Color(0xFFF87171)) },
                    onClick = {
                        open = false
                        onCancel()
                    },
                )
            }
        }
    }
}

private fun formatRemaining(ms: Long): String {
    val totalSeconds = (ms + 999) / 1000
    val mins = totalSeconds / 60
    val secs = totalSeconds % 60
    return "$mins:${secs.toString().padStart(2, '0')}"
}
