package com.musicvault.ui.vault

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.musicvault.data.cloud.CloudClient
import com.musicvault.data.repo.LibraryRepository
import com.musicvault.data.vault.PreparedCover
import com.musicvault.data.vault.SharedCover
import com.musicvault.data.vault.UploadItem
import com.musicvault.data.vault.UploadManager
import com.musicvault.data.vault.VaultApi
import com.musicvault.domain.model.Track
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import javax.inject.Inject

/**
 * Upload, edit-details and delete-from-vault actions for the Android UI
 * (docs/drive-to-r2-migration.md §2.4–2.5). Uploads live in [UploadManager]
 * (application scope), so they keep going when screens change.
 */
@HiltViewModel
class VaultViewModel @Inject constructor(
    private val uploads: UploadManager,
    private val library: LibraryRepository,
    private val vaultApi: VaultApi,
) : ViewModel() {

    val signedIn: StateFlow<Boolean> = (CloudClient.client?.auth?.sessionStatus?.map { it is SessionStatus.Authenticated }
        ?: flowOf(false))
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), vaultApi.userId() != null)

    val items: StateFlow<List<UploadItem>> = uploads.items
    val shared: StateFlow<Map<String, String>> = uploads.shared
    val sharedCover: StateFlow<SharedCover> = uploads.sharedCover
    val running: StateFlow<Boolean> = uploads.running
    val lastUploaded: StateFlow<Int> = uploads.lastUploaded

    fun addUris(uris: List<Uri>) = uploads.addUris(uris)
    fun setValue(id: String, field: String, value: String) = uploads.setValue(id, field, value)
    fun setItemCover(id: String, cover: PreparedCover?) = uploads.setItemCover(id, cover)
    fun setShared(field: String, value: String) = uploads.setShared(field, value)
    fun setSharedCover(cover: SharedCover) = uploads.setSharedCover(cover)
    fun remove(id: String) = uploads.remove(id)
    fun clearFinished() = uploads.clearFinished()
    fun startUploads() = uploads.start()

    /** Turns a picked image into a vault cover (off the main thread). */
    fun prepareCover(uri: Uri, onResult: (Result<PreparedCover>) -> Unit) = viewModelScope.launch {
        onResult(withContext(Dispatchers.IO) { runCatching { uploads.prepareCover(uri) } })
    }

    // ---- editor ---------------------------------------------------------------------

    private val _editorIds = MutableStateFlow<List<String>?>(null)
    val editorIds: StateFlow<List<String>?> = _editorIds.asStateFlow()

    fun openEditor(ids: List<String>) {
        if (ids.isNotEmpty()) _editorIds.value = ids
    }

    fun closeEditor() {
        _editorIds.value = null
    }

    /**
     * Saves editor changes: [fields] are the form fields to apply; [cover] is
     * null = unchanged, CoverChange.Remove, or CoverChange.Set (uploaded first).
     */
    fun saveEdits(
        ids: List<String>,
        values: Map<String, String>,
        fields: Collection<String>,
        cover: CoverChange?,
        onDone: (String?) -> Unit,
    ) = viewModelScope.launch {
        val error = runCatching {
            val extra = mutableMapOf<String, JsonElement>()
            when (cover) {
                null -> {}
                CoverChange.Remove -> extra["artwork_key"] = JsonNull
                is CoverChange.Set -> extra["artwork_key"] = JsonPrimitive(uploadCover(cover.cover))
            }
            library.editTracks(ids, values, fields, extra)
        }.exceptionOrNull()
        if (error == null) closeEditor()
        onDone(error?.message)
    }

    private suspend fun uploadCover(cover: PreparedCover): String {
        val full = vaultApi.signPutArt(cover.sha256, "full", cover.fullSize)
        vaultApi.putFile(full.url, cover.full, "image/jpeg")
        val thumb = vaultApi.signPutArt(cover.sha256, "thumb", cover.thumbSize)
        vaultApi.putFile(thumb.url, cover.thumb, "image/jpeg")
        return full.key
    }

    fun deleteFromVault(tracks: List<Track>, onDone: (String?) -> Unit) = viewModelScope.launch {
        val error = runCatching { library.deleteFromVault(tracks.map { it.id }) }.exceptionOrNull()
        if (error == null) closeEditor()
        onDone(error?.message)
    }
}

sealed interface CoverChange {
    data object Remove : CoverChange
    data class Set(val cover: PreparedCover) : CoverChange
}
