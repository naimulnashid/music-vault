package com.musicvault.data.repo

import com.musicvault.data.db.PlaylistDao
import com.musicvault.data.db.PlaylistEntity
import com.musicvault.data.db.PlaylistTrackEntity
import com.musicvault.data.sync.PlaylistSnapshot
import com.musicvault.data.sync.RemoteTrackIndex
import com.musicvault.data.sync.SyncBus
import com.musicvault.data.sync.SyncOpPayload
import com.musicvault.data.sync.TrackRef
import com.musicvault.data.vault.PendingEdit
import com.musicvault.data.vault.TrackForm
import com.musicvault.data.vault.VaultApi
import com.musicvault.data.vault.VaultMerge
import com.musicvault.domain.model.Playlist
import com.musicvault.domain.model.Track
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The library: every track in the vault (VaultMerge over the synced track
 * rows, with queued edits and favorites/ratings), plus playlists in Room.
 * Every user mutation also enqueues a sync op via [SyncBus] (a no-op when
 * signed out — there is no library then).
 */
@Singleton
class LibraryRepository @Inject constructor(
    private val playlistDao: PlaylistDao,
    private val remoteTrackIndex: RemoteTrackIndex,
    private val vaultApi: VaultApi,
) {
    private data class Overlay(
        val rows: List<com.musicvault.data.sync.TrackRow>,
        val pending: List<PendingEdit>,
        val favorites: Map<String, Boolean>,
        val ratings: Map<String, Int>,
        val art: Map<String, String>,
    )

    private val overlay: Flow<Overlay> = combine(
        remoteTrackIndex.tracks,
        remoteTrackIndex.pending,
        remoteTrackIndex.favorites,
        remoteTrackIndex.ratings,
        remoteTrackIndex.art,
    ) { rows, pending, favorites, ratings, art -> Overlay(rows, pending, favorites, ratings, art) }

    val tracks: Flow<List<Track>> = overlay.map { o ->
        VaultMerge.merge(o.rows, o.pending, o.favorites, o.ratings, o.art)
    }

    /** The current library, for one-off lookups. */
    private suspend fun currentTracks(): List<Track> = tracks.first()

    val playlists: Flow<List<Playlist>> = combine(
        playlistDao.observePlaylists(),
        playlistDao.observePlaylistTracks(),
    ) { playlists, entries ->
        val byPlaylist = entries.groupBy { it.playlistId }
        playlists.map { p ->
            Playlist(
                id = p.id,
                name = p.name,
                trackIds = byPlaylist[p.id].orEmpty().sortedBy { it.position }.map { it.trackId },
                createdAt = p.createdAt,
                isSmart = p.isSmart,
                smartRules = p.smartRules,
            )
        }
    }

    suspend fun getTrack(id: String): Track? = currentTracks().firstOrNull { it.id == id }

    suspend fun getTracksByIds(ids: List<String>): List<Track> {
        // Preserves the requested order; skips ids that no longer exist.
        val all = currentTracks().associateBy { it.id }
        return ids.mapNotNull { all[it] }
    }

    suspend fun toggleFavorite(id: String) {
        val track = getTrack(id) ?: return
        val remoteId = track.remoteId ?: return
        val favorite = !track.favorite
        remoteTrackIndex.setFavorite(remoteId, favorite)
        SyncBus.refFromTrack(track)?.let { SyncBus.enqueue(SyncOpPayload.FavoriteSet(it, favorite, SyncBus.nowIso())) }
    }

    /**
     * Edits details online (track.edit, field-level LWW) for one or more tracks.
     * [values] are form strings for the given [fields]; [extra] carries
     * non-form fields such as the cover key. Throws TrackForm.Invalid for bad
     * input, or IllegalStateException when signed out.
     */
    suspend fun editTracks(
        ids: List<String>,
        values: Map<String, String>,
        fields: Collection<String>,
        extra: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(),
    ) {
        if (vaultApi.userId() == null) throw IllegalStateException("Sign in to edit track details — they're stored online.")
        val patch = kotlinx.serialization.json.JsonObject(TrackForm.normalize(values, fields) + extra)
        if (patch.isEmpty()) return
        val editedAt = SyncBus.nowIso()
        val all = currentTracks().associateBy { it.id }
        val added = mutableListOf<PendingEdit>()
        for (id in ids) {
            val track = all[id] ?: continue
            val ref = SyncBus.refFromTrack(track) ?: continue
            SyncBus.enqueue(SyncOpPayload.TrackEditOp(ref, patch, editedAt))
            added += PendingEdit(ref.keys(), patch, editedAt)
        }
        remoteTrackIndex.addPending(added)
    }

    /** "Delete from vault": removes the audio and the tracks' online history. */
    suspend fun deleteFromVault(ids: List<String>) {
        val targets = currentTracks().filter { it.id in ids && it.remoteId != null && it.storageKey != null }
        val deleted = HashSet<String>()
        for (track in targets) {
            vaultApi.remove(track.remoteId!!)
            deleted += track.remoteId
            playlistDao.removeTrackFromAllPlaylists(track.id)
        }
        if (deleted.isNotEmpty()) remoteTrackIndex.markDeleted(deleted, SyncBus.nowIso())
    }

    suspend fun setSmartRules(id: String, smartRulesJson: String) {
        playlistDao.setSmartRules(id, smartRulesJson)
        enqueuePlaylistUpsert(id)
    }

    suspend fun createPlaylist(name: String): String {
        val id = UUID.randomUUID().toString()
        playlistDao.insertPlaylist(PlaylistEntity(id = id, name = name, createdAt = System.currentTimeMillis()))
        enqueuePlaylistUpsert(id)
        return id
    }

    suspend fun renamePlaylist(id: String, name: String) {
        playlistDao.renamePlaylist(id, name)
        enqueuePlaylistUpsert(id)
    }

    suspend fun deletePlaylist(id: String) {
        playlistDao.deletePlaylistTracks(id)
        playlistDao.deletePlaylist(id)
        SyncBus.enqueue(SyncOpPayload.PlaylistDelete(id, SyncBus.nowIso()))
    }

    suspend fun addTrackToPlaylist(playlistId: String, trackId: String) {
        // Anchor the sync op on the current last track before inserting locally.
        val prevRef = playlistDao.tracksFor(playlistId).lastOrNull()?.let { refForId(it.trackId) }
        val position = playlistDao.nextPosition(playlistId)
        playlistDao.insertPlaylistTrack(PlaylistTrackEntity(playlistId, trackId, position))
        refForId(trackId)?.let {
            SyncBus.enqueue(
                SyncOpPayload.PlaylistItemAdd(playlistId, it, prevTrack = prevRef, editedAt = SyncBus.nowIso()),
            )
        }
    }

    suspend fun removeTrackFromPlaylist(playlistId: String, trackId: String) {
        playlistDao.removePlaylistTrack(playlistId, trackId)
        refForId(trackId)?.let {
            SyncBus.enqueue(SyncOpPayload.PlaylistItemRemove(playlistId, it, SyncBus.nowIso()))
        }
    }

    suspend fun reorderPlaylist(playlistId: String, trackIds: List<String>) {
        playlistDao.replacePlaylistTracks(playlistId, trackIds)
        val refs = trackIds.mapNotNull { refForId(it) }
        if (refs.isNotEmpty()) {
            SyncBus.enqueue(SyncOpPayload.PlaylistReorder(playlistId, refs, SyncBus.nowIso()))
        }
    }

    // ---- sync helpers -----------------------------------------------------------

    /** TrackRef for a library track id. */
    private suspend fun refForId(id: String): TrackRef? = getTrack(id)?.let { SyncBus.refFromTrack(it) }

    private suspend fun enqueuePlaylistUpsert(id: String) {
        val p = playlistDao.getPlaylist(id) ?: return
        val rules: JsonElement? = p.smartRules?.let {
            try {
                Json.parseToJsonElement(it)
            } catch (e: Exception) {
                Timber.w(e, "unparseable smart rules on playlist %s", id)
                null
            }
        }
        SyncBus.enqueue(
            SyncOpPayload.PlaylistUpsertOp(
                PlaylistSnapshot(
                    id = p.id,
                    parentId = null,
                    name = p.name,
                    isFolder = false,
                    isSmart = p.isSmart,
                    smartRules = rules,
                    position = "a0", // playlist ordering deferred (same as desktop/web)
                ),
                SyncBus.nowIso(),
            ),
        )
    }
}
