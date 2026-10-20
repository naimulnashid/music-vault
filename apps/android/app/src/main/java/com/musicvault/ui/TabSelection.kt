package com.musicvault.ui

/**
 * The bottom-bar tab a back stack belongs to. Switching tabs pops to the
 * start destination (the first tab) before pushing the new tab's root, so a
 * stack holds the start root plus at most one other tab root, and every page
 * above it belongs to that tab, wherever it was opened from.
 */
internal fun selectedTabRoute(tabRoutes: List<String>, startRoute: String, inBackStack: (String) -> Boolean): String =
    tabRoutes.firstOrNull { it != startRoute && inBackStack(it) } ?: startRoute
