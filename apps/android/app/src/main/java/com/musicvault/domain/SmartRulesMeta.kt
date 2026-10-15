package com.musicvault.domain

import kotlinx.serialization.json.JsonPrimitive

/**
 * UI metadata for the rule builder — Kotlin mirror of RULE_FIELDS /
 * RULE_OPS_FOR_TYPE / RULE_OP_LABELS / defaultConditionFor in
 * packages/core/src/smartRules.ts. Keep the tables in lockstep.
 */
object SmartRulesMeta {

    enum class FieldType { STRING, NUMBER, DATE, BOOLEAN }

    data class FieldMeta(val key: String, val label: String, val type: FieldType)

    /** Declaration order matches the TS table (drives dropdown order). */
    val FIELDS: List<FieldMeta> = listOf(
        FieldMeta("title", "Title", FieldType.STRING),
        FieldMeta("artist", "Artist", FieldType.STRING),
        FieldMeta("album", "Album", FieldType.STRING),
        FieldMeta("genre", "Genre", FieldType.STRING),
        FieldMeta("language", "Language", FieldType.STRING),
        FieldMeta("country", "Country", FieldType.STRING),
        FieldMeta("year", "Year", FieldType.NUMBER),
        FieldMeta("duration", "Duration (seconds)", FieldType.NUMBER),
        FieldMeta("playCount", "Play Count", FieldType.NUMBER),
        FieldMeta("addedAt", "Date Added", FieldType.DATE),
        FieldMeta("lastPlayedAt", "Last Played", FieldType.DATE),
        FieldMeta("favorite", "Favorite", FieldType.BOOLEAN),
    )

    val FIELDS_BY_KEY: Map<String, FieldMeta> = FIELDS.associateBy { it.key }

    fun opsForType(type: FieldType): List<String> = when (type) {
        FieldType.STRING -> listOf("is", "isNot", "contains", "notContains", "startsWith", "isSet", "notSet")
        FieldType.NUMBER -> listOf("eq", "neq", "gt", "gte", "lt", "lte", "between", "isSet", "notSet")
        FieldType.DATE -> listOf("before", "after", "inLast", "isSet", "notSet")
        FieldType.BOOLEAN -> listOf("isTrue", "isFalse")
    }

    val OP_LABELS: Map<String, String> = mapOf(
        "is" to "is",
        "isNot" to "is not",
        "contains" to "contains",
        "notContains" to "does not contain",
        "startsWith" to "starts with",
        "eq" to "=",
        "neq" to "≠",
        "gt" to ">",
        "gte" to "≥",
        "lt" to "<",
        "lte" to "≤",
        "between" to "between",
        "before" to "before",
        "after" to "after",
        "inLast" to "in the last (days)",
        "isSet" to "is set",
        "notSet" to "is not set",
        "isTrue" to "is on",
        "isFalse" to "is off",
    )

    /** Ops that take no value input. */
    val NO_VALUE_OPS: Set<String> = setOf("isSet", "notSet", "isTrue", "isFalse")

    fun defaultConditionFor(field: String): RuleCondition {
        val meta = FIELDS_BY_KEY.getValue(field)
        return when (meta.type) {
            FieldType.STRING -> RuleCondition(field, "contains", JsonPrimitive(""))
            FieldType.NUMBER -> RuleCondition(field, "gt", JsonPrimitive(0))
            FieldType.DATE -> RuleCondition(field, "inLast", JsonPrimitive(30))
            FieldType.BOOLEAN -> RuleCondition(field, "isTrue")
        }
    }

    /** Sortable fields (favorite excluded, as in the TS editor). */
    val SORT_FIELDS: List<FieldMeta> = FIELDS.filter { it.key != "favorite" }
}
