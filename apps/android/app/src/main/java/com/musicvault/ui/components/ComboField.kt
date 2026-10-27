package com.musicvault.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.domain.SmartPlaylists
import com.musicvault.domain.model.Track

/** Distinct library values per field, sorted; artists, genres, languages and countries split at commas (web lib/fieldOptions.ts). */
class FieldOptions(private val lists: Map<String, List<String>>) {
    operator fun get(field: String): List<String> = lists[field].orEmpty()

    companion object {
        val EMPTY = FieldOptions(emptyMap())

        /** Short lists show everything when opened; long ones show matches while typing. */
        val SHOW_ALL = setOf("language", "country")
        val MULTI = setOf("artist", "genre", "language", "country")
        val FIELDS = setOf("title", "artist", "album", "genre", "language", "country")

        fun of(tracks: List<Track>): FieldOptions {
            val sets = FIELDS.associateWith { sortedSetOf(String.CASE_INSENSITIVE_ORDER) }
            for (t in tracks) {
                if (t.title.isNotBlank()) sets.getValue("title").add(t.title)
                if (t.artist != "Unknown Artist") sets.getValue("artist").addAll(SmartPlaylists.splitNames(t.artist))
                if (t.album.isNotBlank() && t.album != "Unknown Album") sets.getValue("album").add(t.album)
                sets.getValue("genre").addAll(SmartPlaylists.splitNames(t.genre))
                sets.getValue("language").addAll(SmartPlaylists.splitNames(t.language))
                sets.getValue("country").addAll(SmartPlaylists.splitNames(t.country))
            }
            return FieldOptions(sets.mapValues { it.value.toList() })
        }
    }
}

val LocalFieldOptions = compositionLocalOf { FieldOptions.EMPTY }

/**
 * A text field with suggestions. [showAll]: opening it lists every option,
 * whatever is typed, so a wrong value never hides the right one. Otherwise
 * the list opens while typing and holds only the matches. [multi] treats the
 * value as comma-separated names and completes the one after the last comma.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComboField(
    value: String,
    onValueChange: (String) -> Unit,
    options: List<String>,
    showAll: Boolean,
    multi: Boolean,
    modifier: Modifier = Modifier,
    label: (@Composable () -> Unit)? = null,
    placeholder: (@Composable () -> Unit)? = null,
    textStyle: TextStyle? = null,
    colors: TextFieldColors? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    val head = if (multi) value.substring(0, value.lastIndexOf(',') + 1) else ""
    val query = (if (multi) value.substring(head.length) else value).trim()
    val shown = when {
        showAll -> options
        query.isEmpty() -> emptyList()
        else -> options.filter { it.contains(query, ignoreCase = true) }.take(50)
    }

    ExposedDropdownMenuBox(expanded = expanded && shown.isNotEmpty(), onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            label = label,
            placeholder = placeholder,
            singleLine = true,
            textStyle = textStyle ?: TextStyle(fontSize = 14.sp),
            trailingIcon = if (showAll) {
                { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) }
            } else {
                null
            },
            colors = colors ?: ExposedDropdownMenuDefaults.outlinedTextFieldColors(),
            modifier = modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded && shown.isNotEmpty(),
            onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(max = 280.dp),
        ) {
            shown.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option, fontSize = 14.sp) },
                    onClick = {
                        onValueChange(if (multi && head.isNotEmpty()) "$head $option" else option)
                        expanded = false
                    },
                )
            }
        }
    }
}
