package com.musicvault.ui.vault

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.data.vault.SharedCover
import com.musicvault.data.vault.TrackForm
import com.musicvault.data.vault.UploadItem
import com.musicvault.data.vault.UploadStatus
import com.musicvault.domain.Format
import com.musicvault.ui.components.PillButton
import com.musicvault.ui.theme.LocalVaultColors

/**
 * "Upload to your vault" (docs/drive-to-r2-migration.md §2.4): pick files (or
 * share them to MusicVault), review what each file's tags say, optionally set
 * album-wide fields and one cover, then upload. Nothing leaves the phone until
 * the user taps Upload.
 */
@Composable
fun UploadScreen(viewModel: VaultViewModel) {
    val colors = LocalVaultColors.current
    val items by viewModel.items.collectAsStateWithLifecycle()
    val shared by viewModel.shared.collectAsStateWithLifecycle()
    val sharedCover by viewModel.sharedCover.collectAsStateWithLifecycle()
    val running by viewModel.running.collectAsStateWithLifecycle()
    var coverError by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        viewModel.addUris(uris)
    }
    val uploadable = items.count { it.status == UploadStatus.READY || it.status == UploadStatus.FAILED }
    val done = items.count { it.status == UploadStatus.DONE }
    val withSource = items.count { it.source != null }

    Column(modifier = Modifier.fillMaxSize().background(colors.bg)) {
        val addFiles = @Composable {
            PillButton(
                "Add files",
                onClick = { picker.launch(arrayOf("audio/*")) },
                icon = Icons.Rounded.Add,
                enabled = !running,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 24.dp),
                modifier = Modifier.height(48.dp),
            )
        }

        // The title and Back live in the app's top bar.
        if (items.isEmpty()) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp),
            ) {
                Icon(Icons.Rounded.CloudUpload, null, tint = colors.textMuted, modifier = Modifier.size(48.dp))
                Spacer(Modifier.size(12.dp))
                Text(
                    "Choose songs with “Add files”, or share them to MusicVault from another app.",
                    color = colors.textMuted,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                )
                Text(
                    "You'll review each song's details before anything uploads.",
                    color = colors.textMuted,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Spacer(Modifier.size(24.dp))
                addFiles()
            }
        } else {
            Row(
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            ) { addFiles() }

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (withSource > 1) {
                    item(key = "shared") {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.dp, colors.border, RoundedCornerShape(10.dp))
                                .padding(12.dp),
                        ) {
                            Text("For all $withSource files", color = colors.text, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                            Text("Anything filled in here replaces each file's own value. Leave blank to keep them.", color = colors.textMuted, fontSize = 12.sp)
                            Spacer(Modifier.size(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    CoverControl(
                                        picked = (sharedCover as? SharedCover.Set)?.cover,
                                        existingPath = null,
                                        size = 72.dp,
                                        enabled = !running,
                                        onPick = { uri ->
                                            viewModel.prepareCover(uri) { r ->
                                                r.onSuccess { viewModel.setSharedCover(SharedCover.Set(it)) }.onFailure { coverError = it.message }
                                            }
                                        },
                                        onRemove = { viewModel.setSharedCover(SharedCover.None) },
                                    )
                                    if (sharedCover != SharedCover.Keep) {
                                        TextButton(onClick = { viewModel.setSharedCover(SharedCover.Keep) }) {
                                            Text("Use each file's cover", fontSize = 11.sp)
                                        }
                                    }
                                }
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f)) {
                                    TrackForm.SHARED_FIELDS.forEach { field ->
                                        FieldInput(field, shared, viewModel::setShared, placeholder = "Keep each file's")
                                    }
                                }
                            }
                            coverError?.let { Text(it, color = androidx.compose.ui.graphics.Color(0xFFF87171), fontSize = 12.sp) }
                        }
                    }
                }
                items(items, key = { it.id }) { item ->
                    UploadRow(item, viewModel, running, sharedCover)
                }
            }
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().background(colors.surface).padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Text(
                when {
                    running -> "Uploading… $done done"
                    done > 0 -> "$done uploaded"
                    else -> "$uploadable ready"
                },
                color = colors.textMuted,
                fontSize = 13.sp,
                modifier = Modifier.weight(1f),
            )
            if (done > 0 && !running) TextButton(onClick = viewModel::clearFinished) { Text("Clear finished") }
            Button(
                onClick = viewModel::startUploads,
                enabled = !running && uploadable > 0,
                colors = ButtonDefaults.buttonColors(containerColor = colors.accent, contentColor = colors.accentFg),
            ) {
                Icon(Icons.Rounded.CloudUpload, null, modifier = Modifier.size(18.dp))
                Text(if (running) " Uploading…" else " Upload ${if (uploadable > 0) uploadable else ""}".trimEnd())
            }
        }
    }
}

@Composable
private fun UploadRow(item: UploadItem, viewModel: VaultViewModel, running: Boolean, sharedCover: SharedCover) {
    val colors = LocalVaultColors.current
    val editable = item.status == UploadStatus.READY || item.status == UploadStatus.FAILED
    val coverForRow = when (sharedCover) {
        SharedCover.Keep -> item.cover
        SharedCover.None -> null
        is SharedCover.Set -> sharedCover.cover
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, colors.border, RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CoverControl(
                picked = coverForRow,
                existingPath = null,
                size = 56.dp,
                enabled = editable && sharedCover == SharedCover.Keep && item.source != null,
                onPick = { uri -> viewModel.prepareCover(uri) { r -> r.onSuccess { viewModel.setItemCover(item.id, it) } } },
                onRemove = { viewModel.setItemCover(item.id, null) },
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        item.name + (item.source?.let { " · " + Format.formatTime((it.technical.durationSec * 1000).toLong()) } ?: ""),
                        color = colors.textMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (!running && item.status != UploadStatus.UPLOADING) {
                        IconButton(onClick = { viewModel.remove(item.id) }, modifier = Modifier.size(28.dp)) {
                            Icon(Icons.Rounded.Close, "Remove", tint = colors.textMuted, modifier = Modifier.size(16.dp))
                        }
                    }
                }
                if (item.source != null) {
                    FieldInput("title", item.values, { f, v -> viewModel.setValue(item.id, f, v) })
                    FieldInput("artist", item.values, { f, v -> viewModel.setValue(item.id, f, v) })
                }
                StatusLine(item)
                if (item.status == UploadStatus.UPLOADING && item.total > 0 && item.stage == "Uploading…") {
                    LinearProgressIndicator(
                        progress = { (item.sent.toFloat() / item.total).coerceIn(0f, 1f) },
                        color = colors.accent,
                        trackColor = colors.surface2,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        if (item.source != null) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                TrackForm.UPLOAD_FIELDS.filter { it != "title" && it != "artist" }.forEach { field ->
                    FieldInput(field, item.values, { f, v -> viewModel.setValue(item.id, f, v) })
                }
            }
        }
    }
}

@Composable
private fun StatusLine(item: UploadItem) {
    val colors = LocalVaultColors.current
    val red = androidx.compose.ui.graphics.Color(0xFFF87171)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        when (item.status) {
            UploadStatus.PREPARING -> {
                CircularProgressIndicator(strokeWidth = 2.dp, color = colors.textMuted, modifier = Modifier.size(12.dp))
                Text("Reading file…", color = colors.textMuted, fontSize = 12.sp)
            }
            UploadStatus.INVALID, UploadStatus.FAILED -> {
                Icon(Icons.Rounded.ErrorOutline, null, tint = red, modifier = Modifier.size(14.dp))
                Text(item.error.orEmpty(), color = red, fontSize = 12.sp)
            }
            UploadStatus.QUEUED -> Text("Waiting…", color = colors.textMuted, fontSize = 12.sp)
            UploadStatus.UPLOADING -> {
                CircularProgressIndicator(strokeWidth = 2.dp, color = colors.textMuted, modifier = Modifier.size(12.dp))
                val pct = if (item.total > 0 && item.stage == "Uploading…") " ${(item.sent * 100 / item.total)}%" else ""
                Text((item.stage ?: "Uploading…") + pct, color = colors.textMuted, fontSize = 12.sp)
            }
            UploadStatus.DONE -> {
                Icon(Icons.Rounded.CheckCircle, null, tint = colors.accent, modifier = Modifier.size(14.dp))
                Text(item.outcome ?: "Uploaded", color = colors.accent, fontSize = 12.sp)
            }
            UploadStatus.READY -> item.existingTitle?.let {
                Icon(Icons.Rounded.Link, null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
                Text("Matches “$it” — its plays and playlists are kept", color = colors.textMuted, fontSize = 12.sp)
            }
        }
    }
}
