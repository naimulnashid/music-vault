package com.musicvault.data.sync

/**
 * Fractional index strings for list ordering (playlists, playlist items).
 * 1:1 port of packages/core/src/sync/fractional.ts — semantics are locked by
 * docs/sync-protocol.md and must change in lockstep with the TS engine.
 *
 * Keys are base-62 strings ordered lexicographically. Inserting between two
 * keys never touches sibling rows, so concurrent reorders on different
 * devices merge cleanly. `keyBetween(null, null)` is "a0" — the schema
 * default for `position`.
 */
object Fractional {

    private const val DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

    private val SMALLEST_KEY = "A" + DIGITS[0].toString().repeat(26)

    private fun integerLength(head: Char): Int = when (head) {
        in 'a'..'z' -> head - 'a' + 2
        in 'A'..'Z' -> 'Z' - head + 2
        else -> throw IllegalArgumentException("invalid order key head: $head")
    }

    private fun integerPart(key: String): String {
        val len = integerLength(key[0])
        require(len <= key.length) { "invalid order key: $key" }
        return key.substring(0, len)
    }

    private fun validateInteger(int: String) {
        require(int.length == integerLength(int[0])) { "invalid integer part: $int" }
    }

    fun validateOrderKey(key: String) {
        require(key != SMALLEST_KEY) { "invalid order key: $key" }
        val int = integerPart(key) // throws on a bad head/length
        val frac = key.substring(int.length)
        require(!frac.endsWith(DIGITS[0])) { "order key fraction ends in smallest digit: $key" }
    }

    /** Next integer, or null when the space is exhausted (practically unreachable). */
    private fun incrementInteger(int: String): String? {
        validateInteger(int)
        val head = int[0]
        val digits = int.substring(1).toCharArray().toMutableList()
        var carry = true
        var i = digits.size - 1
        while (carry && i >= 0) {
            val d = DIGITS.indexOf(digits[i]) + 1
            if (d == DIGITS.length) {
                digits[i] = DIGITS[0]
            } else {
                digits[i] = DIGITS[d]
                carry = false
            }
            i--
        }
        if (!carry) return head + digits.joinToString("")
        if (head == 'Z') return "a" + DIGITS[0]
        if (head == 'z') return null
        val nextHead = head + 1
        // Positive heads grow their digit count; negative heads shrink it.
        if (nextHead > 'a') digits.add(DIGITS[0]) else digits.removeAt(digits.size - 1)
        return nextHead + digits.joinToString("")
    }

    /** Previous integer, or null when the space is exhausted. */
    private fun decrementInteger(int: String): String? {
        validateInteger(int)
        val head = int[0]
        val digits = int.substring(1).toCharArray().toMutableList()
        var borrow = true
        var i = digits.size - 1
        while (borrow && i >= 0) {
            val d = DIGITS.indexOf(digits[i]) - 1
            if (d == -1) {
                digits[i] = DIGITS[DIGITS.length - 1]
            } else {
                digits[i] = DIGITS[d]
                borrow = false
            }
            i--
        }
        if (!borrow) return head + digits.joinToString("")
        if (head == 'a') return "Z" + DIGITS[DIGITS.length - 1]
        if (head == 'A') return null
        val prevHead = head - 1
        // Mirrors incrementInteger: crossing back below 'a' grows the digit count.
        if (prevHead < 'Z') digits.add(DIGITS[DIGITS.length - 1]) else digits.removeAt(digits.size - 1)
        return prevHead + digits.joinToString("")
    }

    /**
     * A fraction string strictly between a and b, where "" is treated as the
     * lower bound and null as +infinity. a and b must not end in the smallest
     * digit and a must sort before b.
     */
    private fun midpoint(a: String, b: String?): String {
        require(b == null || a < b) { "midpoint: $a >= $b" }
        require(!a.endsWith(DIGITS[0]) && (b == null || !b.endsWith(DIGITS[0]))) {
            "midpoint: trailing smallest digit"
        }
        if (b != null) {
            // Strip the longest common prefix and recurse on the tail.
            var n = 0
            while (n < b.length && (if (n < a.length) a[n] else DIGITS[0]) == b[n]) n++
            if (n > 0) return b.substring(0, n) + midpoint(a.drop(n), b.drop(n))
        }
        val digitA = if (a.isEmpty()) 0 else DIGITS.indexOf(a[0])
        val digitB = if (b == null) DIGITS.length else DIGITS.indexOf(b[0])
        if (digitB - digitA > 1) {
            return DIGITS[(digitA + digitB + 1) / 2].toString() // round half up, as in TS
        }
        // Consecutive first digits: extend under b if it has room, else under a.
        if (b != null && b.length > 1) return b[0].toString()
        return DIGITS[digitA] + midpoint(a.drop(1), null)
    }

    /**
     * Returns a key strictly between a and b (lexicographically). null bounds
     * mean the start/end of the list: keyBetween(null, null) == "a0".
     */
    fun keyBetween(a: String?, b: String?): String {
        if (a != null) validateOrderKey(a)
        if (b != null) validateOrderKey(b)
        require(a == null || b == null || a < b) { "keyBetween: $a >= $b" }

        if (a == null) {
            if (b == null) return "a" + DIGITS[0]
            val intB = integerPart(b)
            val fracB = b.substring(intB.length)
            if (intB == SMALLEST_KEY) return intB + midpoint("", fracB)
            if (intB < b) return intB // b has a fraction — its bare integer sorts before it
            val prev = decrementInteger(intB)
                ?: throw IllegalArgumentException("keyBetween: cannot go below the smallest key")
            return prev
        }

        if (b == null) {
            val intA = integerPart(a)
            val fracA = a.substring(intA.length)
            val next = incrementInteger(intA)
            return next ?: (intA + midpoint(fracA, null))
        }

        val intA = integerPart(a)
        val fracA = a.substring(intA.length)
        val intB = integerPart(b)
        val fracB = b.substring(intB.length)
        if (intA == intB) return intA + midpoint(fracA, fracB)
        val next = incrementInteger(intA)
            ?: throw IllegalArgumentException("keyBetween: cannot go above the largest key")
        if (next < b) return next
        return intA + midpoint(fracA, null)
    }

    /** n distinct ascending keys strictly between a and b. */
    fun nKeysBetween(a: String?, b: String?, n: Int): List<String> {
        if (n <= 0) return emptyList()
        if (n == 1) return listOf(keyBetween(a, b))
        if (b == null) {
            val keys = mutableListOf(keyBetween(a, null))
            for (i in 1 until n) keys.add(keyBetween(keys[i - 1], null))
            return keys
        }
        if (a == null) {
            val keys = mutableListOf(keyBetween(null, b))
            for (i in 1 until n) keys.add(keyBetween(null, keys[i - 1]))
            return keys.reversed()
        }
        val mid = n / 2
        val center = keyBetween(a, b)
        return nKeysBetween(a, center, mid) + center + nKeysBetween(center, b, n - mid - 1)
    }
}
