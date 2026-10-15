package com.musicvault.data.sync

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class FractionalTest {

    @Test
    fun `keyBetween(null, null) is the schema default a0`() {
        assertThat(Fractional.keyBetween(null, null)).isEqualTo("a0")
    }

    @Test
    fun `appending yields ever-increasing keys`() {
        var key = Fractional.keyBetween(null, null)
        val keys = mutableListOf(key)
        repeat(200) {
            key = Fractional.keyBetween(key, null)
            keys.add(key)
        }
        assertThat(keys).isInStrictOrder()
        assertThat(keys[1]).isEqualTo("a1")
    }

    @Test
    fun `prepending yields ever-decreasing keys`() {
        var key = Fractional.keyBetween(null, null)
        val keys = mutableListOf(key)
        repeat(200) {
            key = Fractional.keyBetween(null, key)
            keys.add(key)
        }
        assertThat(keys.reversed()).isInStrictOrder()
        assertThat(keys[1]).isEqualTo("Zz")
    }

    @Test
    fun `midpoint insertion stays strictly between the bounds`() {
        var lo = Fractional.keyBetween(null, null)
        val hi = Fractional.keyBetween(lo, null)
        repeat(100) {
            val mid = Fractional.keyBetween(lo, hi)
            assertThat(mid).isGreaterThan(lo)
            assertThat(mid).isLessThan(hi)
            lo = mid
        }
    }

    @Test
    fun `nKeysBetween returns n sorted keys inside the bounds`() {
        val keys = Fractional.nKeysBetween("a0", "a1", 20)
        assertThat(keys).hasSize(20)
        assertThat(keys).isInStrictOrder()
        assertThat(keys.first()).isGreaterThan("a0")
        assertThat(keys.last()).isLessThan("a1")

        val open = Fractional.nKeysBetween(null, null, 8)
        assertThat(open).hasSize(8)
        assertThat(open).isInStrictOrder()
    }

    @Test
    fun `validateOrderKey rejects malformed keys`() {
        Fractional.validateOrderKey("a0") // valid — no throw
        Fractional.validateOrderKey("Zz")
        assertThrows { Fractional.validateOrderKey("a00") } // fraction ends in smallest digit
        assertThrows { Fractional.validateOrderKey("0") } // invalid head
        assertThrows { Fractional.validateOrderKey("b0") } // integer part too short
    }

    private fun assertThrows(block: () -> Unit) {
        try {
            block()
        } catch (_: IllegalArgumentException) {
            return
        }
        throw AssertionError("expected IllegalArgumentException")
    }
}
