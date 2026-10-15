package com.musicvault.data.sync

import com.musicvault.data.cloud.AuthRepository
import com.musicvault.data.cloud.CloudClient
import com.musicvault.data.db.PlaylistDao
import com.musicvault.data.db.PlaylistEntity
import com.musicvault.data.prefs.SettingsRepository
import com.musicvault.data.vault.PendingEdit
import com.musicvault.data.vault.DownloadRepository
import com.musicvault.data.vault.VaultArtwork
import com.musicvault.data.vault.VaultMerge
import com.musicvault.di.ApplicationScope
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owns the sync engine lifecycle — the Kotlin counterpart of desktop's
 * store/syncStore.ts. Starts an engine when a session becomes authenticated,
 * installs [SyncBus] so repositories enqueue mutations, applies pulled remote
 * state into Room/DataStore, and tears everything down (wiping local sync
 * state) on sign-out or account switch.
 */
@Singleton
class SyncManager @Inject constructor(
    private val authRepository: AuthRepository,
    private val storage: RoomSyncStorage,
    private val playlistDao: PlaylistDao,
    private val settingsRepository: SettingsRepository,
    private val remoteTrackIndex: RemoteTrackIndex,
    private val vaultArtwork: VaultArtwork,
    // Lazy: built on first use, not while the Application is being injected.
    private val downloadRepository: dagger.Lazy<DownloadRepository>,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private var engine: SyncEngine? = null
    private var engineUserId: String? = null

    private val _status = MutableStateFlow(SyncStatus())
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    /**
     * Latest "continue from other device" queue pulled from the server.
     * Playback integration (Phase 6c) consumes and clears it; it never
     * interrupts active local playback.
     */
    private val _queueHandoff = MutableStateFlow<QueueChange?>(null)
    val queueHandoff: StateFlow<QueueChange?> = _queueHandoff.asStateFlow()

    fun consumeQueueHandoff(): QueueChange? = _queueHandoff.value.also { _queueHandoff.value = null }

    /** Call once from Application.onCreate. Safe no-op without Supabase config. */
    fun start() {
        val client = CloudClient.client ?: return
        scope.launch {
            var wasSignedIn = false
            client.auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> {
                        val userId = status.session.user?.id ?: return@collect
                        if (engine == null || engineUserId != userId) {
                            stopEngine()
                            startEngine(userId)
                            wasSignedIn = true
                        }
                    }
                    is SessionStatus.NotAuthenticated -> {
                        stopEngine()
                        if (wasSignedIn) {
                            // Explicit sign-out in this process: wipe outbox/cursors/shadow
                            // and the playlists mirrored from the account.
                            storage.clearAll()
                            clearPlaylists()
                            wasSignedIn = false
                        }
                    }
                    else -> {} // Initializing / RefreshFailure — keep whatever runs
                }
            }
        }
    }

    private suspend fun startEngine(userId: String) {
        val client = CloudClient.client ?: return

        // Account switch: local sync state belongs to exactly one account.
        val knownUser = storage.cursorGet(CURSOR_USER)
        if (knownUser != null && knownUser != userId) {
            storage.clearAll()
            clearPlaylists()
        }
        storage.cursorSet(CURSOR_USER, userId)

        // Make sure the device row exists so ops can be attributed (idempotent).
        authRepository.registerDevice()
        val deviceId = authRepository.deviceId()

        val newEngine = SyncEngine(
            transport = SupabaseSyncTransport(client, userId, scope),
            storage = storage,
            options = SyncEngine.Options(
                deviceId = deviceId,
                scope = scope,
                onChanges = { changes -> scope.launch { applyChanges(changes) } },
                onStatus = { _status.value = it },
                onBreadcrumb = { crumb -> android.util.Log.d("MVSync", "${crumb.event} ${crumb.detail}") },
            ),
        )
        newEngine.init()
        engine = newEngine
        engineUserId = userId
        refreshRemoteTrackIndex()

        SyncBus.install(deviceId) { payload ->
            scope.launch { engine?.enqueue(payload) }
        }

        newEngine.start() // Realtime pull-sooner hints
        scope.launch { newEngine.syncNow(fullPull = true) } // startup safety-net pull
        Timber.i("sync engine started (device=%s)", deviceId)
    }

    private fun stopEngine() {
        SyncBus.uninstall()
        engine?.stop()
        engine = null
        engineUserId = null
        remoteTrackIndex.clear()
        _status.value = SyncStatus()
    }

    /**
     * Reloads what the library merges from the shadow: canonical track rows,
     * still-queued track.edit ops, and cloud tracks' favorites/ratings. Then
     * makes sure online covers are cached.
     */
    private suspend fun refreshRemoteTrackIndex() {
        val rows = storage.shadowAll("tracks").mapNotNull { row ->
            try {
                SyncJson.decodeFromString(TrackRow.serializer(), row.payload)
            } catch (e: Exception) {
                Timber.w(e, "bad track shadow row %s", row.id)
                null
            }
        }
        remoteTrackIndex.set(rows)
        refreshShadowState()
        scope.launch { vaultArtwork.sync() }
        // Tracks deleted from the vault (anywhere): their pinned copies go too.
        scope.launch {
            runCatching { downloadRepository.get().forgetDeleted(rows) }.onFailure { Timber.w(it, "pruning deleted downloads failed") }
        }
    }

    private suspend fun refreshShadowState() {
        val pending = storage.outboxAll().mapNotNull { entry ->
            (entry.op.payload as? SyncOpPayload.TrackEditOp)?.let {
                PendingEdit(it.track.keys(), it.patch, it.editedAt)
            }
        }
        val favorites = storage.shadowAll("favorites").mapNotNull { row ->
            runCatching { SyncJson.decodeFromString(FavoriteRow.serializer(), row.payload) }.getOrNull()
        }.associate { it.trackId to it.favorite }
        val ratings = storage.shadowAll("ratings").mapNotNull { row ->
            runCatching { SyncJson.decodeFromString(RatingRow.serializer(), row.payload) }.getOrNull()
        }.associate { it.trackId to it.rating }
        remoteTrackIndex.setShadowState(pending, favorites, ratings)
    }

    /** Pulls now (after an upload or delete), so the library reflects it quickly. */
    fun syncNow() {
        val e = engine ?: return
        scope.launch { e.syncNow() }
    }

    // ---- applying pulled remote state into Room/DataStore -------------------------

    private suspend fun applyChanges(changes: RemoteChanges) {
        try {
            if (changes.tracksChanged) refreshRemoteTrackIndex()
            else if (changes.favorites.isNotEmpty() || changes.ratings.isNotEmpty()) refreshShadowState()
            for (playlist in changes.playlists) {
                applyPlaylist(playlist)
            }
            for (items in changes.playlistItems) {
                applyPlaylistItems(items)
            }
            for (setting in changes.settings) {
                if (setting.scope == "global" || setting.scope == SyncBus.deviceId) {
                    settingsRepository.applyRemoteSetting(setting.key, setting.value)
                }
            }
            changes.queue?.let { queue ->
                // Only surface handoffs written by other devices.
                if (queue.deviceId != SyncBus.deviceId || queue.deviceId == null) {
                    _queueHandoff.value = queue
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "applying pulled sync changes failed")
        }
    }

    private suspend fun applyPlaylist(change: PlaylistChange) {
        if (change.isFolder) return // playlist folders UI is deferred (as on desktop)
        if (change.deleted) {
            playlistDao.deletePlaylistTracks(change.id)
            playlistDao.deletePlaylist(change.id)
            return
        }
        val existing = playlistDao.getPlaylist(change.id)
        playlistDao.insertPlaylist(
            PlaylistEntity(
                id = change.id,
                name = change.name,
                createdAt = existing?.createdAt ?: System.currentTimeMillis(),
                isSmart = change.isSmart,
                smartRules = change.smartRules?.toString(),
            ),
        )
    }

    private suspend fun applyPlaylistItems(change: PlaylistItemsChange) {
        if (playlistDao.getPlaylist(change.playlistId) == null) return
        val live = remoteTrackIndex.tracks.value.filter { it.storageKey != null && it.deletedAt == null }
        val hashById = live.mapNotNull { r -> r.contentHash?.let { r.id to it } }.toMap()
        val vaultHashes = hashById.values.toHashSet()
        val ids = change.tracks.mapNotNull { identity ->
            val hash = hashById[identity.remoteId] ?: identity.contentHash?.takeIf { it in vaultHashes }
            hash?.let { VaultMerge.VAULT_ID_PREFIX + it }
        }
        playlistDao.replacePlaylistTracks(change.playlistId, ids)
    }


    /** Playlists are mirrored from the signed-in account; another account starts clean. */
    private suspend fun clearPlaylists() {
        for (playlist in playlistDao.getAllPlaylists()) {
            playlistDao.deletePlaylistTracks(playlist.id)
            playlistDao.deletePlaylist(playlist.id)
        }
    }

    private companion object {
        const val CURSOR_USER = "user"
    }
}
