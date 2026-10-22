package com.musicvault.data.vault

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** Same cases as maskReleaseDate in packages/core/tests/trackFields.test.ts. */
class TrackFormMaskTest {

    @Test
    fun `drops non-digits and inserts hyphens while typing`() {
        assertThat(TrackForm.maskReleaseDate("", "2")).isEqualTo("2")
        assertThat(TrackForm.maskReleaseDate("201", "2019")).isEqualTo("2019-")
        assertThat(TrackForm.maskReleaseDate("2019-", "2019-0")).isEqualTo("2019-0")
        assertThat(TrackForm.maskReleaseDate("2019-0", "2019-05")).isEqualTo("2019-05-")
        assertThat(TrackForm.maskReleaseDate("2019-05-1", "2019-05-14")).isEqualTo("2019-05-14")
        assertThat(TrackForm.maskReleaseDate("2019-05-14", "2019-05-149")).isEqualTo("2019-05-14")
        assertThat(TrackForm.maskReleaseDate("", "2019a/05.14")).isEqualTo("2019-05-14")
    }

    @Test
    fun `backspace removes the hyphen`() {
        assertThat(TrackForm.maskReleaseDate("2019-", "2019")).isEqualTo("2019")
        assertThat(TrackForm.maskReleaseDate("2019-05-", "2019-05")).isEqualTo("2019-05")
    }
}
