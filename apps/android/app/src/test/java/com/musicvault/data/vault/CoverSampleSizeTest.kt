package com.musicvault.data.vault

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CoverSampleSizeTest {
    @Test
    fun `covers up to twice the target decode at full size`() {
        assertThat(coverSampleSize(1000, 1000, 1200)).isEqualTo(1)
        assertThat(coverSampleSize(2399, 3000, 1200)).isEqualTo(1)
    }

    @Test
    fun `big photos are subsampled but keep the short edge at or above the target`() {
        assertThat(coverSampleSize(2400, 2400, 1200)).isEqualTo(2)
        assertThat(coverSampleSize(8000, 6000, 1200)).isEqualTo(4) // 2000 x 1500
        assertThat(coverSampleSize(6000, 8000, 1200)).isEqualTo(4)
        for ((w, h) in listOf(2400 to 2400, 8000 to 6000, 12000 to 9000)) {
            assertThat(minOf(w, h) / coverSampleSize(w, h, 1200)).isAtLeast(1200)
        }
    }

    @Test
    fun `an unreadable image (no bounds) is not subsampled`() {
        assertThat(coverSampleSize(-1, -1, 1200)).isEqualTo(1)
    }
}
