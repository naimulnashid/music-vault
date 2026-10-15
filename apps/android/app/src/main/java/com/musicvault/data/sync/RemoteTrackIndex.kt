package com.musicvault.data.sync

import com.musicvault.data.vault.PendingEdit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What this device knows from the sync shadow about canonical tracks: the
 * Supabase rows (incl. tombstones), track.edit ops still queued, favorites
 * and ratings of cloud tracks (which have no Room row to hold them), and the
 * cached files of online covers. LibraryRepository merges all of it into the
 * library view (VaultMerge). Empty when signed out.
 */
@Singleton
class RemoteTrackIndex @Inject constructor() {
    private val _tracks = MutableStateFlow<List<TrackRow>>(emptyList())
    val tracks: StateFlow<List<TrackRow>> = _tracks.asStateFlow()

    private val _pending = MutableStateFlow<List<PendingEdit>>(emptyList())
    val pending: StateFlow<List<PendingEdit>> = _pending.asStateFlow()

    /** Remote track id → favorite / rating (shadow + optimistic local changes). */
    private val _favorites = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val favorites: StateFlow<Map<String, Boolean>> = _favorites.asStateFlow()
    private val _ratings = MutableStateFlow<Map<String, Int>>(emptyMap())
    val ratings: StateFlow<Map<String, Int>> = _ratings.asStateFlow()

    /** Online cover key → cached file path. */
    private val _art = MutableStateFlow<Map<String, String>>(emptyMap())
    val art: StateFlow<Map<String, String>> = _art.asStateFlow()

    fun set(rows: List<TrackRow>) {
        _tracks.value = rows
    }

    fun setShadowState(pending: List<PendingEdit>, favorites: Map<String, Boolean>, ratings: Map<String, Int>) {
        _pending.value = pending
        _favorites.value = favorites
        _ratings.value = ratings
    }

    /** Optimistic: a just-queued edit shows before it flushes. */
    fun addPending(edits: List<PendingEdit>) = _pending.update { it + edits }

    fun setFavorite(remoteId: String, favorite: Boolean) = _favorites.update { it + (remoteId to favorite) }

    fun setRating(remoteId: String, rating: Int) = _ratings.update { it + (remoteId to rating) }

    fun addArt(found: Map<String, String>) = _art.update { it + found }

    /** Hides deleted tracks immediately (the pull brings the tombstones). */
    fun markDeleted(remoteIds: Set<String>, nowIso: String) = _tracks.update { rows ->
        rows.map { if (it.id in remoteIds) it.copy(deletedAt = nowIso, storageKey = null, artworkKey = null) else it }
    }

    fun clear() {
        _tracks.value = emptyList()
        _pending.value = emptyList()
        _favorites.value = emptyMap()
        _ratings.value = emptyMap()
    }
}
