package com.musicvault.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.Downloading
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.musicvault.data.vault.VaultMerge
import com.musicvault.domain.model.Track
import com.musicvault.ui.theme.LocalVaultColors

/**
 * "Download" action for a collection — port of desktop DownloadAllButton.tsx:
 * pins every track not yet on this device. Shows progress while any of them
 * are queued, a done mark once all are pinned, and nothing for an empty list.
 */
@Composable
fun DownloadAllButton(
    tracks: List<Track>,
    pinnedIds: Set<String>,
    downloadingIds: Set<String>,
    onDownload: (List<String>) -> Unit,
) {
    if (tracks.isEmpty()) return
    val colors = LocalVaultColors.current
    val missing = tracks.filter { VaultMerge.isCloudUri(it.uri) && it.id !in pinnedIds }
    val busy = missing.any { it.id in downloadingIds }
    val allDone = missing.isEmpty()
    IconButton(onClick = { onDownload(missing.map { it.id }) }, enabled = !allDone && !busy) {
        Icon(
            when {
                allDone -> Icons.Rounded.DownloadDone
                busy -> Icons.Rounded.Downloading
                else -> Icons.Rounded.Download
            },
            when {
                allDone -> "All tracks are downloaded"
                busy -> "Downloading"
                else -> "Download ${missing.size} ${if (missing.size == 1) "track" else "tracks"} to this device"
            },
            tint = if (allDone || busy) colors.accent else colors.textMuted,
            modifier = Modifier.size(18.dp),
        )
    }
}
