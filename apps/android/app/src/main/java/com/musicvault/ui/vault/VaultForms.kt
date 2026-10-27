package com.musicvault.ui.vault

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.musicvault.data.vault.PreparedCover
import com.musicvault.data.vault.TrackForm
import com.musicvault.ui.components.ComboField
import com.musicvault.ui.components.FieldOptions
import com.musicvault.ui.components.LocalFieldOptions
import com.musicvault.ui.theme.LocalVaultColors
import java.io.File

/** Shared form controls for the upload screen and the track editor. */

private val LABELS = TrackForm.FIELDS.toMap()

@Composable
fun FieldInput(
    field: String,
    values: Map<String, String>,
    onChange: (String, String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
) {
    val colors = LocalVaultColors.current
    val multiline = field in TrackForm.MULTILINE
    val isDate = field == "release_date"
    val value = values[field].orEmpty()
    val label: @Composable () -> Unit = { Text(LABELS[field] ?: field, fontSize = 12.sp) }
    val hintText = placeholder ?: TrackForm.PLACEHOLDERS[field]
    val hint: (@Composable () -> Unit)? = hintText?.let { text -> { Text(text, fontSize = 13.sp, color = colors.textMuted) } }
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedTextColor = colors.text,
        unfocusedTextColor = colors.text,
        focusedBorderColor = colors.accent,
        unfocusedBorderColor = colors.border,
        focusedLabelColor = colors.accent,
        unfocusedLabelColor = colors.textMuted,
        cursorColor = colors.accent,
    )
    // Title is suggested in smart rules only; here it stays a plain field.
    if (field in FieldOptions.FIELDS && field != "title") {
        ComboField(
            value = value,
            onValueChange = { onChange(field, it) },
            options = LocalFieldOptions.current[field],
            showAll = field in FieldOptions.SHOW_ALL,
            multi = field in FieldOptions.MULTI,
            label = label,
            placeholder = hint,
            colors = fieldColors,
            modifier = modifier,
        )
        return
    }
    if (isDate) {
        DateInput(value, { onChange(field, it) }, label, hint, fieldColors, modifier)
        return
    }
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(field, it) },
        label = label,
        placeholder = hint,
        singleLine = !multiline,
        minLines = if (multiline) 3 else 1,
        maxLines = if (multiline) 8 else 1,
        colors = fieldColors,
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * Release date (YYYY, YYYY-MM or YYYY-MM-DD) typed as digits, with the dashes
 * added as you go, or picked from a calendar. The field keeps its own cursor:
 * with a plain String the cursor stayed where it was when a dash went in, so
 * the next digit landed before the dash ("2026-09-09" became "2026-90-90").
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateInput(
    value: String,
    onChange: (String) -> Unit,
    label: @Composable () -> Unit,
    hint: (@Composable () -> Unit)?,
    fieldColors: androidx.compose.material3.TextFieldColors,
    modifier: Modifier,
) {
    var text by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
    // A value set from outside (a shared field, a reset) replaces what is shown.
    if (text.text != value) text = TextFieldValue(value, TextRange(value.length))
    var picking by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = text,
        onValueChange = { next ->
            val masked = TrackForm.maskReleaseDate(text.text, next.text)
            text = TextFieldValue(masked, TextRange(masked.length))
            onChange(masked)
        },
        label = label,
        placeholder = hint,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        trailingIcon = {
            IconButton(onClick = { picking = true }) {
                Icon(Icons.Rounded.CalendarMonth, "Pick a date")
            }
        },
        colors = fieldColors,
        modifier = modifier.fillMaxWidth(),
    )
    if (picking) {
        val initial = runCatching { java.time.LocalDate.parse(value) }.getOrNull()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = initial?.atStartOfDay(java.time.ZoneOffset.UTC)?.toInstant()?.toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        onChange(java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate().toString())
                    }
                    picking = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
        ) {
            DatePicker(state = state)
        }
    }
}

/** Cover preview (a picked cover, else an existing artwork path) with pick / remove buttons. */
@Composable
fun CoverControl(
    picked: PreparedCover?,
    existingPath: String?,
    size: Dp,
    enabled: Boolean,
    onPick: (android.net.Uri) -> Unit,
    onRemove: (() -> Unit)?,
) {
    val colors = LocalVaultColors.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onPick(uri)
    }
    val path = picked?.thumb?.absolutePath ?: existingPath
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
            modifier = Modifier
                .size(size)
                .clip(RoundedCornerShape(6.dp))
                .background(colors.surface2),
            contentAlignment = Alignment.Center,
        ) {
            if (path != null) {
                AsyncImage(model = File(path), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else {
                Icon(Icons.Rounded.MusicNote, null, tint = colors.textMuted, modifier = Modifier.size(size / 3))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(
                onClick = { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                enabled = enabled,
            ) {
                Icon(Icons.Rounded.AddPhotoAlternate, null, modifier = Modifier.size(16.dp))
                Text(" Cover", fontSize = 12.sp)
            }
            if (onRemove != null && path != null) {
                IconButton(onClick = onRemove, enabled = enabled, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Rounded.Delete, "Remove cover", tint = colors.textMuted, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        color = LocalVaultColors.current.textMuted,
        fontSize = 11.sp,
        modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
    )
}
