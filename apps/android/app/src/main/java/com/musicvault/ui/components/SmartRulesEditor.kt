package com.musicvault.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicvault.domain.RuleCondition
import com.musicvault.domain.RuleGroup
import com.musicvault.domain.RuleNode
import com.musicvault.domain.SmartRules
import com.musicvault.domain.SmartRulesMeta
import com.musicvault.ui.theme.LocalVaultColors
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Rule builder for smart playlists — Compose port of the desktop
 * SmartRulesEditor.tsx. Edits an immutable [SmartRules] AST; Save hands the
 * result back for `playlists.smartRules` (shared JSON schema across clients).
 */
@Composable
fun SmartRulesEditorDialog(
    initial: SmartRules,
    onSave: (SmartRules) -> Unit,
    onDismiss: () -> Unit,
) {
    var rules by remember { mutableStateOf(initial) }
    val colors = LocalVaultColors.current

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Smart playlist rules", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 480.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                GroupEditor(
                    group = rules.root,
                    depth = 0,
                    onChange = { rules = rules.copy(root = it) },
                    onRemove = null,
                )

                Spacer(Modifier.size(12.dp))
                HorizontalBorder()
                Spacer(Modifier.size(8.dp))

                // Sort + limit
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Sort by", color = colors.textMuted, fontSize = 12.sp)
                    Spacer(Modifier.size(8.dp))
                    RuleDropdown(
                        label = rules.sortBy?.let { SmartRulesMeta.FIELDS_BY_KEY[it]?.label } ?: "Manual",
                        options = listOf(null to "Manual (library order)") +
                            SmartRulesMeta.SORT_FIELDS.map { it.key to it.label },
                        onSelect = { key -> rules = rules.copy(sortBy = key, sortDir = rules.sortDir ?: "asc") },
                    )
                    if (rules.sortBy != null) {
                        Spacer(Modifier.size(8.dp))
                        RuleDropdown(
                            label = if (rules.sortDir == "desc") "descending" else "ascending",
                            options = listOf("asc" to "ascending", "desc" to "descending"),
                            onSelect = { dir -> rules = rules.copy(sortDir = dir) },
                        )
                    }
                }
                Spacer(Modifier.size(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Limit", color = colors.textMuted, fontSize = 12.sp)
                    Spacer(Modifier.size(8.dp))
                    var limitText by remember(rules.limit) {
                        mutableStateOf(rules.limit?.toString() ?: "")
                    }
                    OutlinedTextField(
                        value = limitText,
                        onValueChange = { text ->
                            limitText = text
                            rules = rules.copy(limit = text.toIntOrNull()?.coerceAtLeast(1))
                        },
                        placeholder = { Text("none", fontSize = 12.sp) },
                        singleLine = true,
                        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 13.sp),
                        modifier = Modifier.width(96.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(rules) }) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

private fun List<RuleNode>.replaceAt(index: Int, node: RuleNode): List<RuleNode> =
    mapIndexed { i, n -> if (i == index) node else n }

@Composable
private fun GroupEditor(
    group: RuleGroup,
    depth: Int,
    onChange: (RuleGroup) -> Unit,
    onRemove: (() -> Unit)?,
) {
    val colors = LocalVaultColors.current
    Column(
        modifier = if (depth > 0) Modifier.padding(start = 12.dp) else Modifier,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Match", color = colors.textMuted, fontSize = 12.sp)
            Spacer(Modifier.size(6.dp))
            RuleDropdown(
                label = if (group.combinator == "or") "any" else "all",
                options = listOf("and" to "all", "or" to "any"),
                onSelect = { onChange(group.copy(combinator = it)) },
            )
            Spacer(Modifier.size(6.dp))
            Text("of the following", color = colors.textMuted, fontSize = 12.sp)
            if (onRemove != null) {
                IconButton(onClick = onRemove) {
                    Icon(Icons.Rounded.Close, "Remove group", tint = colors.textMuted, modifier = Modifier.size(16.dp))
                }
            }
        }

        group.rules.forEachIndexed { i, node ->
            when (node) {
                is RuleGroup -> GroupEditor(
                    group = node,
                    depth = depth + 1,
                    onChange = { onChange(group.copy(rules = group.rules.replaceAt(i, it))) },
                    onRemove = { onChange(group.copy(rules = group.rules.filterIndexed { j, _ -> j != i })) },
                )
                is RuleCondition -> ConditionRow(
                    cond = node,
                    onChange = { onChange(group.copy(rules = group.rules.replaceAt(i, it))) },
                    onRemove = { onChange(group.copy(rules = group.rules.filterIndexed { j, _ -> j != i })) },
                )
            }
        }

        Row {
            TextButton(onClick = {
                onChange(group.copy(rules = group.rules + SmartRulesMeta.defaultConditionFor("genre")))
            }) {
                Icon(Icons.Rounded.Add, null, modifier = Modifier.size(14.dp))
                Text("Rule", fontSize = 12.sp)
            }
            if (depth < 3) {
                TextButton(onClick = {
                    onChange(group.copy(rules = group.rules + RuleGroup()))
                }) {
                    Icon(Icons.Rounded.Add, null, modifier = Modifier.size(14.dp))
                    Text("Group", fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
private fun ConditionRow(
    cond: RuleCondition,
    onChange: (RuleCondition) -> Unit,
    onRemove: () -> Unit,
) {
    val colors = LocalVaultColors.current
    val meta = SmartRulesMeta.FIELDS_BY_KEY[cond.field] ?: SmartRulesMeta.FIELDS.first()
    val ops = SmartRulesMeta.opsForType(meta.type)
    val needsValue = cond.op !in SmartRulesMeta.NO_VALUE_OPS

    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RuleDropdown(
                label = meta.label,
                options = SmartRulesMeta.FIELDS.map { it.key to it.label },
                onSelect = { onChange(SmartRulesMeta.defaultConditionFor(it)) },
            )
            Spacer(Modifier.size(6.dp))
            RuleDropdown(
                label = SmartRulesMeta.OP_LABELS[cond.op] ?: cond.op,
                options = ops.map { it to (SmartRulesMeta.OP_LABELS[it] ?: it) },
                onSelect = { onChange(cond.copy(op = it)) },
            )
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onRemove) {
                Icon(Icons.Rounded.Close, "Remove rule", tint = colors.textMuted, modifier = Modifier.size(16.dp))
            }
        }
        if (needsValue) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ConditionValueInput(cond, meta.type, onChange)
            }
        }
    }
}

@Composable
private fun ConditionValueInput(
    cond: RuleCondition,
    type: SmartRulesMeta.FieldType,
    onChange: (RuleCondition) -> Unit,
) {
    val colors = LocalVaultColors.current
    val textStyle = androidx.compose.ui.text.TextStyle(fontSize = 13.sp)

    when {
        type == SmartRulesMeta.FieldType.STRING -> {
            var text by remember(cond.field, cond.op) { mutableStateOf(cond.value?.content ?: "") }
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it
                    onChange(cond.copy(value = JsonPrimitive(it)))
                },
                placeholder = { Text("value", fontSize = 12.sp) },
                singleLine = true,
                textStyle = textStyle,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        type == SmartRulesMeta.FieldType.DATE && cond.op != "inLast" -> {
            // ISO date in, epoch ms out (the AST stores timestamps).
            var text by remember(cond.field, cond.op) {
                mutableStateOf(
                    cond.value?.doubleOrNull?.let {
                        Instant.ofEpochMilli(it.toLong()).atZone(ZoneOffset.UTC).toLocalDate().toString()
                    } ?: "",
                )
            }
            OutlinedTextField(
                value = text,
                onValueChange = { input ->
                    text = input
                    runCatching { LocalDate.parse(input) }.getOrNull()?.let { date ->
                        val ms = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
                        onChange(cond.copy(value = JsonPrimitive(ms)))
                    }
                },
                placeholder = { Text("YYYY-MM-DD", fontSize = 12.sp) },
                singleLine = true,
                textStyle = textStyle,
                modifier = Modifier.width(160.dp),
            )
        }

        else -> {
            // Plain numbers, and inLast's day count.
            var text by remember(cond.field, cond.op) {
                mutableStateOf(cond.value?.doubleOrNull?.let { formatNumber(it) } ?: "")
            }
            OutlinedTextField(
                value = text,
                onValueChange = { input ->
                    text = input
                    input.toDoubleOrNull()?.let { onChange(cond.copy(value = JsonPrimitive(it))) }
                },
                placeholder = { Text(if (cond.op == "inLast") "days" else "value", fontSize = 12.sp) },
                singleLine = true,
                textStyle = textStyle,
                modifier = Modifier.width(96.dp),
            )
            if (cond.op == "between") {
                Spacer(Modifier.size(6.dp))
                Text("and", color = colors.textMuted, fontSize = 12.sp)
                Spacer(Modifier.size(6.dp))
                var text2 by remember(cond.field, cond.op) {
                    mutableStateOf(cond.value2?.let { formatNumber(it) } ?: "")
                }
                OutlinedTextField(
                    value = text2,
                    onValueChange = { input ->
                        text2 = input
                        onChange(cond.copy(value2 = input.toDoubleOrNull()))
                    },
                    singleLine = true,
                    textStyle = textStyle,
                    modifier = Modifier.width(96.dp),
                )
            }
        }
    }
}

private fun formatNumber(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

/** Compact dropdown: current value + caret, options in a DropdownMenu. */
@Composable
private fun <T> RuleDropdown(
    label: String,
    options: List<Pair<T, String>>,
    onSelect: (T) -> Unit,
) {
    val colors = LocalVaultColors.current
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) {
            Text(label, fontSize = 12.sp, color = colors.text)
            Icon(Icons.Rounded.ArrowDropDown, null, tint = colors.textMuted, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(
                    text = { Text(text, fontSize = 13.sp) },
                    onClick = {
                        open = false
                        onSelect(value)
                    },
                )
            }
        }
    }
}
