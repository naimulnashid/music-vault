package com.musicvault.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.domain.model.Track
import com.musicvault.ui.theme.LocalVaultColors

/** Rows shown at once; a search narrows a big library to what fits. */
private const val MAX_ROWS = 100

/** Picks songs from the library straight into a playlist, without leaving it (web: AddSongsDialog). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddSongsSheet(
    playlistName: String,
    inPlaylist: Set<String>,
    tracks: List<Track>,
    onAdd: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = LocalVaultColors.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    val matches = remember(tracks, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) tracks
        else tracks.filter { t -> listOf(t.title, t.artist, t.album).any { it.lowercase().contains(q) } }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Text(
                "Add songs to “$playlistName”",
                color = colors.text,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search by title, artist or album") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
                items(matches.take(MAX_ROWS), key = { it.id }) { track ->
                    val added = track.id in inPlaylist
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 6.dp)) {
                        AlbumArt(track.artworkPath, modifier = Modifier.size(42.dp), shape = RoundedCornerShape(6.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                track.title,
                                color = colors.text,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(track.artist, color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        // Stays enabled once added: a disabled button drops keyboard and TalkBack focus.
                        IconButton(onClick = { if (!added) onAdd(track.id) }) {
                            Icon(
                                if (added) Icons.Rounded.Check else Icons.Rounded.Add,
                                if (added) "${track.title} is in the playlist" else "Add ${track.title}",
                                tint = if (added) colors.accent else colors.text,
                            )
                        }
                    }
                }
                if (matches.isEmpty()) {
                    item {
                        Text(
                            "No songs match “${query.trim()}”.",
                            color = colors.textMuted,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            ) {
                Text(
                    if (matches.size > MAX_ROWS) "First $MAX_ROWS of ${matches.size}; search to narrow." else "",
                    color = colors.textMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                PillButton("Done", onClick = onDismiss, primary = true)
            }
        }
    }
}
