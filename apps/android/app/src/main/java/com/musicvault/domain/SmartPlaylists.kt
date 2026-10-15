package com.musicvault.domain

import com.musicvault.domain.model.Track

/** Port of smartPlaylists.ts. */
enum class SmartKey { RECENTLY_ADDED, RECENTLY_PLAYED, MOST_PLAYED, FAVORITES, NEVER_PLAYED, GENRE, ARTIST, YEAR, LANGUAGE }

enum class SmartKind { LIST, GROUP }

data class SmartDef(
    val key: SmartKey,
    val label: String,
    val kind: SmartKind,
    val emptyMessage: String,
)

data class HistoryData(
    val recentIds: List<String>,
    val playCounts: Map<String, Int>,
)

data class SmartGroup(val name: String, val tracks: List<Track>)

object SmartPlaylists {
    val ALL: List<SmartDef> = listOf(
        SmartDef(SmartKey.RECENTLY_ADDED, "Recently Added", SmartKind.LIST, "Import some music to see it here."),
        SmartDef(SmartKey.RECENTLY_PLAYED, "Recently Played", SmartKind.LIST, "Nothing played yet."),
        SmartDef(SmartKey.MOST_PLAYED, "Most Played", SmartKind.LIST, "Play some tracks to build this list."),
        SmartDef(SmartKey.FAVORITES, "Favorites", SmartKind.LIST, "Tap the heart on any track to add it here."),
        SmartDef(SmartKey.NEVER_PLAYED, "Never Played", SmartKind.LIST, "Every track has been played at least once."),
        SmartDef(SmartKey.GENRE, "By Genre", SmartKind.GROUP, "No genre tags found in your library."),
        SmartDef(SmartKey.ARTIST, "By Artist", SmartKind.GROUP, "No artists found."),
        SmartDef(SmartKey.YEAR, "By Year", SmartKind.GROUP, "No year tags found in your library."),
        SmartDef(SmartKey.LANGUAGE, "By Language", SmartKind.GROUP, "No language tags found in your library."),
    )

    fun def(key: SmartKey): SmartDef = ALL.first { it.key == key }

    fun computeSmartTracks(key: SmartKey, tracks: List<Track>, history: HistoryData): List<Track> = when (key) {
        SmartKey.RECENTLY_ADDED -> tracks.sortedByDescending { it.addedAt }
        SmartKey.RECENTLY_PLAYED -> {
            val byId = tracks.associateBy { it.id }
            history.recentIds.mapNotNull { byId[it] }
        }
        SmartKey.MOST_PLAYED -> tracks
            .filter { (history.playCounts[it.id] ?: 0) > 0 }
            .sortedByDescending { history.playCounts[it.id] ?: 0 }
        SmartKey.FAVORITES -> tracks.filter { it.favorite }
        SmartKey.NEVER_PLAYED -> tracks.filter { (history.playCounts[it.id] ?: 0) == 0 }
        else -> emptyList()
    }

    private fun groupOf(key: SmartKey, track: Track): String = when (key) {
        SmartKey.GENRE -> track.genre?.takeIf { it.isNotBlank() } ?: "Unknown Genre"
        SmartKey.ARTIST -> track.artist.takeIf { it.isNotBlank() } ?: "Unknown Artist"
        SmartKey.YEAR -> track.year?.toString() ?: "Unknown Year"
        SmartKey.LANGUAGE -> track.language?.takeIf { it.isNotBlank() } ?: "Unknown Language"
        else -> ""
    }

    fun computeSmartGroups(key: SmartKey, tracks: List<Track>): List<SmartGroup> {
        val map = LinkedHashMap<String, MutableList<Track>>()
        for (track in tracks) {
            map.getOrPut(groupOf(key, track)) { mutableListOf() }.add(track)
        }
        val groups = map.map { (name, groupTracks) -> SmartGroup(name, groupTracks) }
        return if (key == SmartKey.YEAR) {
            groups.sortedByDescending { if (it.name.startsWith("Unknown")) -1 else it.name.toIntOrNull() ?: -1 }
        } else {
            groups.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        }
    }
}
