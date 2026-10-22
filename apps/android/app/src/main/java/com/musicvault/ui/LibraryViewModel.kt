package com.musicvault.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import android.net.Uri
import com.musicvault.data.vault.ArtistPhotos
import com.musicvault.data.vault.DownloadRepository
import com.musicvault.data.vault.UploadManager
import com.musicvault.data.repo.HistoryRepository
import com.musicvault.data.repo.HistorySnapshot
import com.musicvault.data.repo.LibraryRepository
import com.musicvault.domain.model.Playlist
import com.musicvault.domain.model.Track
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import javax.inject.Inject

/** Web libraryStore sort keys. */
enum class SortKey(val label: String) { ARTIST("Artist"), ALBUM("Album"), TITLE("Title") }

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val libraryRepository: LibraryRepository,
    private val historyRepository: HistoryRepository,
    private val downloadRepository: DownloadRepository,
    private val artistPhotos: ArtistPhotos,
    private val uploads: UploadManager,
) : ViewModel() {

    /** Artist → cached photo file, for artists given a photo of their own. */
    val artistPhotoPaths: StateFlow<Map<String, String>> = artistPhotos.paths
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    /** Artist → cover key of their photo (set even before the file is cached). */
    val artistPhotoKeys: StateFlow<Map<String, String>> = artistPhotos.keys
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    val canEditArtistPhotos: Boolean get() = artistPhotos.signedIn

    /** Sets the artist's photo from a picked image, or removes it when [uri] is null; [onDone] gets an error message. */
    fun setArtistPhoto(artist: String, uri: Uri?, onDone: (String?) -> Unit) = viewModelScope.launch {
        val error = runCatching {
            val cover = uri?.let { withContext(Dispatchers.IO) { uploads.prepareCover(it) } }
            artistPhotos.set(artist, cover)
        }.exceptionOrNull()
        onDone(error?.message)
    }

    val search = MutableStateFlow("")
    val sortKey = MutableStateFlow(SortKey.ARTIST)

    /** All tracks sorted by the active sort key (libraryStore.sortTracks). */
    val tracks: StateFlow<List<Track>> = combine(libraryRepository.tracks, sortKey) { tracks, key ->
        sortTracks(tracks, key)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Search filter over title/artist/album (LibraryView.tsx). */
    val filteredTracks: StateFlow<List<Track>> = combine(tracks, search) { tracks, query ->
        val q = query.trim().lowercase()
        if (q.isEmpty()) tracks
        else tracks.filter {
            it.title.lowercase().contains(q) ||
                it.artist.lowercase().contains(q) ||
                it.album.lowercase().contains(q)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val playlists: StateFlow<List<Playlist>> = libraryRepository.playlists
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val history: StateFlow<HistorySnapshot> = historyRepository.history
        .stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            HistorySnapshot(emptyList(), emptyMap(), emptyMap()),
        )

    private fun sortTracks(tracks: List<Track>, key: SortKey): List<Track> {
        val selector: (Track) -> String = when (key) {
            SortKey.ARTIST -> Track::artist
            SortKey.ALBUM -> Track::album
            SortKey.TITLE -> Track::title
        }
        return tracks.sortedWith(
            compareBy(String.CASE_INSENSITIVE_ORDER, selector)
                .thenBy(String.CASE_INSENSITIVE_ORDER, Track::title)
        )
    }

    fun toggleFavorite(id: String) = viewModelScope.launch { libraryRepository.toggleFavorite(id) }


    fun createPlaylist(name: String, onCreated: (String) -> Unit = {}) = viewModelScope.launch {
        onCreated(libraryRepository.createPlaylist(name))
    }

    fun renamePlaylist(id: String, name: String) = viewModelScope.launch {
        libraryRepository.renamePlaylist(id, name)
    }

    /** Sets/updates rule-based smart playlist rules (JSON AST). */
    fun setSmartRules(id: String, smartRulesJson: String) = viewModelScope.launch {
        libraryRepository.setSmartRules(id, smartRulesJson)
    }

    fun deletePlaylist(id: String) = viewModelScope.launch { libraryRepository.deletePlaylist(id) }

    fun addTrackToPlaylist(playlistId: String, trackId: String) = viewModelScope.launch {
        libraryRepository.addTrackToPlaylist(playlistId, trackId)
    }

    fun removeTrackFromPlaylist(playlistId: String, trackId: String) = viewModelScope.launch {
        libraryRepository.removeTrackFromPlaylist(playlistId, trackId)
    }

    fun reorderPlaylist(playlistId: String, trackIds: List<String>) = viewModelScope.launch {
        libraryRepository.reorderPlaylist(playlistId, trackIds)
    }

    fun clearRecents() = viewModelScope.launch { historyRepository.clearRecents() }

    /** Pins a track to this device (queues a WorkManager download under its id). */
    fun downloadTrack(id: String) = downloadRepository.enqueue(id)

    /** Pins every given track (a playlist's "Download"); already-pinned ones are skipped by the queue. */
    fun downloadTracks(ids: List<String>) = downloadRepository.enqueueAll(ids)

    /** Track ids pinned to this device. */
    val pinnedIds: StateFlow<Set<String>> = downloadRepository.pinnedFileIds
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    /**
     * Downloads queued or running, track id → progress 0..1 (null while the
     * size is unknown or the work is still waiting for its constraints).
     */
    val downloadProgress: StateFlow<Map<String, Float?>> = downloadRepository.activeWork
        .map { infos ->
            infos.filter { !it.state.isFinished }.mapNotNull { info ->
                val id = info.tags.firstOrNull { it.startsWith("${DownloadRepository.WORK_TAG}-") }
                    ?.removePrefix("${DownloadRepository.WORK_TAG}-") ?: return@mapNotNull null
                val read = info.progress.getLong(com.musicvault.data.vault.DownloadWorker.KEY_BYTES_READ, 0)
                val total = info.progress.getLong(com.musicvault.data.vault.DownloadWorker.KEY_BYTES_TOTAL, -1)
                id to (if (total > 0) (read.toFloat() / total).coerceIn(0f, 1f) else null)
            }.toMap()
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    /** Stops a queued or running download. */
    fun cancelDownload(id: String) = downloadRepository.cancel(id)

    /** Removes a pinned download from this device (the song stays in the vault). */
    fun removeDownload(id: String) = viewModelScope.launch { downloadRepository.remove(id) }

    /** Track ids whose download is queued or running. */
    val downloadingIds: StateFlow<Set<String>> = downloadRepository.activeWork
        .map { infos ->
            infos.filter { !it.state.isFinished }.mapNotNull { info ->
                info.tags.firstOrNull { it.startsWith("${DownloadRepository.WORK_TAG}-") }
                    ?.removePrefix("${DownloadRepository.WORK_TAG}-")
            }.toSet()
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())
}
