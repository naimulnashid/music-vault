package com.musicvault.data.sync

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.test.runTest
import org.junit.Test

class ReadAllPagesTest {

    /** A server holding [total] rows that returns at most [cap] per request, like PostgREST's max-rows. */
    private class FakeServer(private val total: Int, private val cap: Int) {
        val requests = mutableListOf<Long>()

        fun page(from: Long, to: Long): List<Int> {
            requests += from
            val end = minOf(to + 1, from + cap, total.toLong())
            return if (from >= end) emptyList() else (from until end).map { it.toInt() }
        }
    }

    @Test
    fun `reads every row of a playlist bigger than one response`() = runTest {
        val server = FakeServer(total = 2_345, cap = 1_000)
        val rows = readAllPages(1_000) { from, to -> server.page(from, to) }
        assertThat(rows).isEqualTo((0 until 2_345).toList())
    }

    @Test
    fun `does not stop early when the server cap is below the page size`() = runTest {
        val server = FakeServer(total = 1_200, cap = 250)
        val rows = readAllPages(1_000) { from, to -> server.page(from, to) }
        assertThat(rows).hasSize(1_200)
        assertThat(server.requests).containsExactly(0L, 250L, 500L, 750L, 1_000L, 1_200L).inOrder()
    }

    @Test
    fun `an empty result costs one request`() = runTest {
        val server = FakeServer(total = 0, cap = 1_000)
        assertThat(readAllPages(1_000) { from, to -> server.page(from, to) }).isEmpty()
        assertThat(server.requests).hasSize(1)
    }
}
