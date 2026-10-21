package com.musicvault.playback


/** Page [page] of [items], [pageSize] per page; empty past the end or for an invalid request. */
internal fun <T> pageOf(items: List<T>, page: Int, pageSize: Int): List<T> {
    if (page < 0 || pageSize < 1) return emptyList()
    val from = page.toLong() * pageSize
    if (from >= items.size) return emptyList()
    return items.subList(from.toInt(), minOf(items.size.toLong(), from + pageSize).toInt())
}
