package com.musicvault.domain

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Test
import java.io.File

/**
 * Verifies the Kotlin smart-rules engine against the shared golden fixtures in
 * docs/fixtures/smart-rules.golden.json — the same cases the TypeScript engine
 * runs in packages/core/tests/smartRules.test.ts. If this test and the vitest
 * suite both pass, the two engines agree.
 */
class SmartRulesGoldenTest {

    @Serializable
    private data class GoldenCase(val name: String, val rules: SmartRules, val expected: List<String>)

    @Serializable
    private data class GoldenFile(
        val now: Long,
        val tracks: List<RuleTrackInput>,
        val cases: List<GoldenCase>,
    )

    private fun findFixture(): File {
        // Unit tests run from the module dir (apps/android/app); walk up to the repo root.
        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "docs/fixtures/smart-rules.golden.json")
            if (candidate.exists()) return candidate
            dir = dir.parentFile
        }
        error("smart-rules.golden.json not found above ${File(".").absolutePath}")
    }

    private val golden: GoldenFile =
        Json { ignoreUnknownKeys = true }.decodeFromString(GoldenFile.serializer(), findFixture().readText())

    @Test
    fun `all golden cases match the TypeScript engine`() {
        val failures = golden.cases.mapNotNull { case ->
            val actual = SmartRulesEngine.evaluate(case.rules, golden.tracks, golden.now)
            if (actual != case.expected) "${case.name}: expected ${case.expected}, got $actual" else null
        }
        assertThat(failures).isEmpty()
    }

    @Test
    fun `fixture has meaningful coverage`() {
        assertThat(golden.cases.size).isAtLeast(20)
        assertThat(golden.tracks).isNotEmpty()
    }

    @Test
    fun `parse rejects malformed json and empty rules match everything`() {
        assertThat(SmartRules.parse("not json")).isNull()
        val empty = SmartRules.empty()
        val track = golden.tracks.first()
        assertThat(SmartRulesEngine.matchesGroup(empty.root, track, golden.now)).isTrue()
    }

    @Test
    fun `encode round-trips through parse`() {
        val rules = golden.cases.last().rules
        val decoded = SmartRules.parse(rules.encode())
        assertThat(decoded).isEqualTo(rules)
    }
}
