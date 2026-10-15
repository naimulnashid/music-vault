package com.musicvault.data.sync

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import java.io.File

/**
 * Verifies [TrackEdit] against docs/fixtures/track-edit.golden.json — the same
 * cases packages/core/tests/trackFields.test.ts runs against applyTrackEdit,
 * both mirroring public.apply_track_edit. If this and the vitest suite pass,
 * the engines agree.
 */
class TrackEditGoldenTest {

    private fun findFixture(): File {
        // Unit tests run from the module dir (apps/android/app); walk up to the repo root.
        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "docs/fixtures/track-edit.golden.json")
            if (candidate.exists()) return candidate
            dir = dir.parentFile
        }
        error("track-edit.golden.json not found above ${File(".").absolutePath}")
    }

    private val golden: JsonObject = SyncJson.parseToJsonElement(findFixture().readText()).jsonObject
    private val baseRow: JsonObject = golden.getValue("row").jsonObject
    private val cases: JsonArray = golden.getValue("cases").jsonArray

    /** A fixture row (column-named JSON) merged with overrides, decoded as a TrackRow. */
    private fun row(vararg overrides: JsonObject?): TrackRow {
        val merged = buildMap {
            put("id", JsonPrimitive("golden"))
            putAll(baseRow)
            overrides.filterNotNull().forEach { putAll(it) }
        }
        return SyncJson.decodeFromJsonElement(TrackRow.serializer(), JsonObject(merged))
    }

    @Test
    fun `all golden cases match the TypeScript engine`() {
        val failures = cases.mapNotNull { element ->
            val case = element.jsonObject
            val name = case.getValue("name").jsonPrimitive.content
            val overrides = case["row"]?.jsonObject
            val start = row(overrides)
            val edits = case.getValue("edits").jsonArray.map {
                it.jsonObject.getValue("patch").jsonObject to it.jsonObject.getValue("editedAt").jsonPrimitive.content
            }
            val expectedError = case["error"]?.jsonPrimitive?.content
            if (expectedError != null) {
                val (patch, editedAt) = edits.single()
                val code = try {
                    TrackEdit.apply(start, patch, editedAt)
                    "no error"
                } catch (e: TrackEdit.Rejected) {
                    e.code
                }
                return@mapNotNull if (code != expectedError) "$name: expected $expectedError, got $code" else null
            }
            val actual = edits.fold(start) { acc, (patch, editedAt) -> TrackEdit.apply(acc, patch, editedAt) }
            val expected = row(overrides, case.getValue("expected").jsonObject)
            if (actual != expected) "$name:\n  expected $expected\n  got      $actual" else null
        }
        assertThat(failures).isEmpty()
    }

    @Test
    fun `fixture has meaningful coverage`() {
        assertThat(cases.size).isAtLeast(20)
    }

    @Test
    fun `overlay applies queued edits in order and skips invalid ones`() {
        val patch = { json: String -> SyncJson.parseToJsonElement(json).jsonObject }
        val out = TrackEdit.overlay(
            row(),
            listOf(
                patch("""{"title": "First"}""") to "2026-10-11T10:00:00.000Z",
                patch("""{"duration": 1}""") to "2026-10-11T11:00:00.000Z",
                patch("""{"title": "Second", "genre": "Rock"}""") to "2026-10-11T12:00:00.000Z",
            ),
        )
        assertThat(out.title).isEqualTo("Second")
        assertThat(out.genre).isEqualTo("Rock")
    }

    @Test
    fun `queueable patches match isValidTrackPatch`() {
        val patch = { json: String -> SyncJson.parseToJsonElement(json).jsonObject }
        assertThat(TrackEdit.isValidPatch(patch("""{"title": "x"}"""))).isTrue()
        assertThat(TrackEdit.isValidPatch(patch("{}"))).isFalse()
        assertThat(TrackEdit.isValidPatch(patch("""{"title": " "}"""))).isFalse()
        assertThat(TrackEdit.isValidPatch(patch("""{"codec": "mp3"}"""))).isFalse()
    }
}
