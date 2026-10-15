package com.musicvault.ui.vault

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.data.vault.PreparedCover
import com.musicvault.data.vault.TrackForm
import com.musicvault.domain.Format
import com.musicvault.domain.model.Track
import com.musicvault.ui.theme.LocalVaultColors

/**
 * Edit track details — one track or several at once. Details live online:
 * saving queues a track.edit per track (field-level LWW), so the change
 * reaches every device. Facts read from the audio are shown, not editable.
 */
@Composable
fun TrackEditor(tracks: List<Track>, viewModel: VaultViewModel) {
    if (tracks.isEmpty()) return
    val colors = LocalVaultColors.current
    val single = tracks.singleOrNull()
    val initial = remember(tracks.map { it.id }) {
        if (single != null) TrackForm.valuesFromTrack(single) else TrackForm.commonValues(tracks)
    }
    var values by remember(tracks.map { it.id }) { mutableStateOf(initial) }
    var touched by remember(tracks.map { it.id }) { mutableStateOf(setOf<String>()) }
    // null = unchanged; CoverChange.Remove / CoverChange.Set
    var cover by remember(tracks.map { it.id }) { mutableStateOf<CoverChange?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    val inVault = tracks.filter { it.storageKey != null && it.remoteId != null }
    val picked: PreparedCover? = (cover as? CoverChange.Set)?.cover
    val existingArt = if (cover == null) tracks.map { it.artworkPath }.distinct().singleOrNull() else null
    fun differs(field: String) = single == null && initial[field].isNullOrEmpty() &&
        tracks.any { TrackForm.valuesFromTrack(it)[field].orEmpty().isNotEmpty() }

    // A full-screen layer over the app (like Now Playing) rather than a Dialog:
    // a Dialog window ran taller than the display and hid the Save row.
    BackHandler { if (!busy) viewModel.closeEditor() }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            // Swallow touches so they never reach the list underneath.
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
    ) {
        Column(modifier = Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().background(colors.surface).padding(start = 16.dp, end = 4.dp)) {
                Text(
                    if (single != null) "Edit “${single.title}”" else "Edit ${tracks.size} tracks",
                    color = colors.text,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = viewModel::closeEditor, enabled = !busy) { Icon(Icons.Rounded.Close, "Close", tint = colors.text) }
            }

            Column(
                modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (single == null) {
                    Text(
                        "Only the fields you change are applied to all ${tracks.size} tracks. “Multiple values” fields stay as they are unless you type in them.",
                        color = colors.textMuted,
                        fontSize = 12.sp,
                    )
                }
                Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                    CoverControl(
                        picked = picked,
                        existingPath = existingArt,
                        size = 120.dp,
                        enabled = !busy,
                        onPick = { uri ->
                            viewModel.prepareCover(uri) { r ->
                                r.onSuccess { cover = CoverChange.Set(it) }.onFailure { error = it.message }
                            }
                        },
                        onRemove = { cover = CoverChange.Remove },
                    )
                }
                TrackForm.FIELDS.forEach { (field, _) ->
                    FieldInput(
                        field,
                        values,
                        { f, v ->
                            values = values + (f to v)
                            touched = touched + f
                        },
                        placeholder = if (differs(field) && field !in touched) "Multiple values" else null,
                    )
                }
                if (single != null) {
                    SectionLabel("From the audio file")
                    ReadOnlyFacts(single)
                }
                error?.let { Text(it, color = Color(0xFFF87171), fontSize = 12.sp) }
                Spacer(Modifier.size(8.dp))
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().background(colors.surface).padding(horizontal = 8.dp, vertical = 8.dp),
            ) {
                if (inVault.isNotEmpty()) {
                    TextButton(onClick = { confirmDelete = true }, enabled = !busy) {
                        Icon(Icons.Rounded.CloudOff, null, tint = Color(0xFFF87171), modifier = Modifier.size(16.dp))
                        Text(" Delete from vault", color = Color(0xFFF87171), fontSize = 13.sp)
                    }
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = viewModel::closeEditor, enabled = !busy) { Text("Cancel") }
                Button(
                    onClick = {
                        busy = true
                        error = null
                        // One track: what differs from its details. Several: the touched fields.
                        val fields = if (single != null) {
                            TrackForm.FIELDS.map { it.first }.filter { values[it].orEmpty() != initial[it].orEmpty() }
                        } else {
                            touched.toList()
                        }
                        viewModel.saveEdits(tracks.map { it.id }, values, fields, cover) { err ->
                            busy = false
                            error = err
                        }
                    },
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(containerColor = colors.accent, contentColor = colors.accentFg),
                ) {
                    if (busy) CircularProgressIndicator(strokeWidth = 2.dp, color = colors.accentFg, modifier = Modifier.size(14.dp))
                    Text(if (busy) " Saving" else "Save")
                }
            }
        }
    }

    if (confirmDelete) {
        val what = if (inVault.size == 1) "“${inVault[0].title}”" else "these ${inVault.size} tracks"
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete from vault") },
            text = { Text("Delete $what from your vault? The audio is removed from the cloud, together with favorites, playlist entries and play history. This can't be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    busy = true
                    viewModel.deleteFromVault(inVault) { err ->
                        busy = false
                        error = err
                    }
                }) { Text("Delete", color = Color(0xFFF87171)) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep") } },
        )
    }
}

@Composable
private fun ReadOnlyFacts(track: Track) {
    val colors = LocalVaultColors.current
    val facts = listOfNotNull(
        "Length" to Format.formatTime(track.durationMs),
        track.fileSize.takeIf { it > 0 }?.let { "File size" to "%.1f MB".format(it / 1_048_576.0) },
        track.rgTrackGain?.let { "ReplayGain" to "%.2f dB".format(it) },
        "Original file" to track.fileName,
        "Where" to "In your vault",
    )
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        facts.forEach { (label, value) ->
            Row {
                Text(label, color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.size(width = 110.dp, height = 18.dp))
                Text(value, color = colors.text, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Confirmation for deleting tracks from the vault (used from the selection bar). */
@Composable
fun ConfirmDeleteFromVault(tracks: List<Track>, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val inVault = tracks.filter { it.storageKey != null && it.remoteId != null }
    if (inVault.isEmpty()) return
    val what = if (inVault.size == 1) "“${inVault[0].title}”" else "these ${inVault.size} tracks"
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete from vault") },
        text = { Text("Delete $what from your vault? The audio is removed from the cloud, together with favorites, playlist entries and play history. This can't be undone.") },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Delete", color = Color(0xFFF87171)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Keep") } },
    )
}
