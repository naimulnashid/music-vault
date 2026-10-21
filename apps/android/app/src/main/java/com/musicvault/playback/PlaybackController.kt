package com.musicvault.playback

import android.content.Context
import android.content.Intent
import androidx.media3.common.Player
import com.musicvault.data.cloud.CloudClient
import com.musicvault.data.db.QueueDao
import com.musicvault.data.prefs.SettingsRepository
import com.musicvault.data.repo.HistoryRepository
import com.musicvault.data.repo.LibraryRepository
import com.musicvault.data.repo.StatsRepository
import com.musicvault.data.sync.SyncBus
import com.musicvault.di.ApplicationScope
import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Settings
import com.musicvault.domain.model.Track
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

data class PlaybackUiState(
    val queue: List<QueueEntry> = emptyList(),
    val currentIndex: Int = -1,
    val currentTrack: Track? = null,
    val isPlaying: Boolean = false,
    val durationMs: Long = 0L,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.OFF,
    val volume: Float = 0.8f,
)

/**
 * Same-process facade over [VaultPlayer]: applies persisted settings, records
 * history (playerStore + historyStore + lastPlayback glue from useAudioEngine.ts),
 * persists the queue across launches, and runs the sleep timer.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Singleton
class PlaybackController @Inject constructor(
    @ApplicationContext private val context: Context,
    @ApplicationScope private val appScope: CoroutineScope,
    private val settingsRepository: SettingsRepository,
    private val historyRepository: HistoryRepository,
    private val statsRepository: StatsRepository,
    private val libraryRepository: LibraryRepository,
    private val queueDao: QueueDao,
    // Lazy: SyncManager depends on this controller too.
    private val syncManager: dagger.Lazy<com.musicvault.data.sync.SyncManager>,
    vaultDataSourceFactory: VaultDataSourceFactory,
) {
    val player: VaultPlayer = VaultPlayer(context, vaultDataSourceFactory) { ids ->
        libraryRepository.getTracksByIds(ids)
    }

    private val mainScope = CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.Main)

    private val _playbackErrors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    /** One message per song that couldn't be loaded, for the UI to show. */
    val playbackErrors: SharedFlow<String> = _playbackErrors.asSharedFlow()

    private val _uiState = MutableStateFlow(PlaybackUiState())
    val uiState: StateFlow<PlaybackUiState> = _uiState

    private val _positionMs = MutableStateFlow(0L)
    val positionMs: StateFlow<Long> = _positionMs

    private val _sleepRemainingMs = MutableStateFlow<Long?>(null)
    val sleepRemainingMs: StateFlow<Long?> = _sleepRemainingMs
    private var sleepJob: Job? = null

    val audioSessionId: Int get() = player.audioSessionId

    private var settings = Settings()
    private var restored = false

    // Queue handoff: the queue state last pushed or restored (restores never push), the
    // state and playing flag at the last rebuild, and the pending push. Rebuilds come many
    // times a second while playing, so only a change since the last one (re)starts a push.
    private var pushBaseline = QueueKey.EMPTY
    private var lastSeenKey = QueueKey.EMPTY
    private var wasPlaying = false
    private var pushJob: Job? = null

    private val sessionRestore = SessionRestore(
        hydrated = libraryRepository.hydrated,
        savedQueue = { queueDao.getQueue().map { it.trackId } },
        lastPlayback = { settingsRepository.lastPlayback() },
        tracksByIds = { libraryRepository.getTracksByIds(it) },
    )

    private var playSession: PlaySession? = null
    private val checkpoint = PlaySessionCheckpoint(context)

    private fun startPlaySession(track: Track) {
        playSession = PlaySession.start(track.id, SyncBus.refFromTrack(track), CloudClient.client?.auth?.currentUserOrNull()?.id, track.durationMs)
        appScope.launch { historyRepository.recordPlay(track.id) }
    }

    /** Ends the running session (if any) and records its play event. */
    private fun closePlaySession() {
        val session = playSession ?: return
        playSession = null
        checkpoint.clear()
        appScope.launch { record(session, recovered = false) }
    }

    private suspend fun record(session: PlaySession, recovered: Boolean) = statsRepository.recordSession(
        session.eventId, session.trackId, session.startedAtMs, session.seconds,
        session.durationMs, session.ref, session.userId, recovered,
    )

    init {
        // A session left over from a killed process: record it now.
        checkpoint.take()?.let { leftover -> appScope.launch { record(leftover, recovered = true) } }

        player.callback = object : VaultPlayer.Callback {
            override fun onTrackStarted(track: Track) {
                closePlaySession()
                startPlaySession(track)
            }

            override fun onTrackFinished(track: Track) {
                // The next play of the same song (repeat-one, a replay) is a new session.
                closePlaySession()
            }

            override fun onPlaybackFailed(track: Track, error: androidx.media3.common.PlaybackException) {
                _playbackErrors.tryEmit(PlaybackErrors.message(track.title, PlaybackErrors.isOffline(context, error)))
            }

            override fun onQueueChanged(trackIds: List<String>) {
                appScope.launch {
                    try {
                        queueDao.replaceQueue(trackIds)
                    } catch (e: Exception) {
                        Timber.e(e, "Failed to persist queue")
                    }
                }
            }
        }

        player.addListener(object : Player.Listener {
            override fun onEvents(p: Player, events: Player.Events) {
                rebuildUiState()
                _positionMs.value = player.positionMsNow()
            }
        })

        // Apply persisted settings to the engine, and keep applying on change.
        mainScope.launch {
            settingsRepository.settings.collect { s ->
                settings = s
                player.setMasterVolume(s.volume)
                player.setShuffleEnabled(s.shuffle)
                player.setRepeatModeDomain(s.repeat)
                player.setGapless(s.gapless)
                player.setCrossfadeSeconds(s.crossfadeSeconds)
                player.setEqBands(s.eqBands)
                rebuildUiState()
                if (!restored) {
                    restored = true
                    restoreLastSession()
                }
            }
        }

        // Position ticker + per-second listen-time & resume-position persistence
        // (the two 1s intervals in useAudioEngine.ts).
        mainScope.launch {
            var lastPersistAt = 0L
            while (isActive) {
                delay(500)
                if (player.currentTrack != null) {
                    _positionMs.value = player.positionMsNow()
                }
                val now = System.currentTimeMillis()
                if (player.isPlaying && now - lastPersistAt >= 1000) {
                    lastPersistAt = now
                    val track = player.currentTrack
                    val index = player.currentQueueIndex
                    val position = player.positionMsNow()
                    if (track != null) {
                        // The song ended (repeat-one, or replayed at the end of the queue)
                        // and is playing again: that is a new play.
                        if (playSession == null) startPlaySession(track)
                        playSession?.let {
                            if (it.trackId == track.id) {
                                it.seconds += 1
                                checkpoint.save(it)
                            }
                        }
                        appScope.launch {
                            historyRepository.addListenSeconds(track.id, 1)
                            settingsRepository.saveLastPlayback(index, position)
                        }
                    }
                }
            }
        }
    }

    private fun currentQueueKey() = QueueKey(player.queueEntries.map { it.track.id }, player.currentQueueIndex)

    /** Restores and sign-out clears are not edits: their result becomes the baseline. */
    private fun adoptQueueAsBaseline() {
        pushJob?.cancel()
        pushBaseline = currentQueueKey()
        lastSeenKey = pushBaseline
        wasPlaying = player.isPlaying
    }

    /** Schedules a push for queue edits and pauses (web syncStore's player subscription). */
    private fun syncQueueState() {
        val key = currentQueueKey()
        val delayMs = QueueHandoff.pushDelay(lastSeenKey, key, wasPlaying, player.isPlaying)
        val edited = key != lastSeenKey
        lastSeenKey = key
        wasPlaying = player.isPlaying
        if (delayMs == null) return
        if (edited) appScope.launch { settingsRepository.markQueueActivity() }
        pushJob?.cancel()
        pushJob = mainScope.launch {
            delay(delayMs)
            pushQueue()
        }
    }

    private fun pushQueue() {
        val payload = QueueHandoff.payload(
            tracks = player.queueEntries.map { it.track },
            currentIndex = player.currentQueueIndex,
            positionMs = player.positionMsNow(),
            shuffle = player.shuffleEnabled,
            repeat = player.repeatModeDomain,
            editedAt = SyncBus.nowIso(),
        ) ?: return
        SyncBus.enqueue(payload)
        pushBaseline = currentQueueKey()
    }

    private fun rebuildUiState() {
        syncQueueState()
        _uiState.value = PlaybackUiState(
            queue = player.queueEntries,
            currentIndex = player.currentQueueIndex,
            currentTrack = player.currentTrack,
            isPlaying = player.isPlaying,
            durationMs = player.durationMsNow(),
            shuffle = player.shuffleEnabled,
            repeat = player.repeatModeDomain,
            volume = player.volumeLevel,
        )
    }

    /**
     * Restores queue + position from the previous session, paused, once the library has
     * loaded; then a newer queue left on another device takes over if nothing has been
     * touched meanwhile.
     */
    private fun restoreLastSession() {
        appScope.launch {
            // Read first: restores never stamp it, so it is this phone's own last use.
            val localActivity = settingsRepository.lastQueueActivityAt()
            try {
                val plan = sessionRestore.plan()
                if (plan != null) {
                    val applied = withContext(Dispatchers.Main) {
                        // Whatever the user started while the library loaded wins.
                        if (player.currentTrack != null || player.queueEntries.isNotEmpty()) return@withContext false
                        player.restoreQueue(plan.tracks, plan.index, plan.positionMs)
                        _positionMs.value = plan.positionMs
                        adoptQueueAsBaseline()
                        rebuildUiState()
                        true
                    }
                    if (applied) Timber.i("Restored queue of %d tracks at index %d", plan.tracks.size, plan.index)
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore last session")
            }
            try {
                takeOverFromOtherDevice(localActivity)
            } catch (e: Exception) {
                Timber.e(e, "Queue handoff failed")
            }
        }
    }

    /** Newest wins: another device's queue replaces this one if it was written later. */
    private suspend fun takeOverFromOtherDevice(localActivityMs: Long?) {
        val remote = syncManager.get().startupQueue() ?: return
        libraryRepository.hydrated.first { it }
        val library = libraryRepository.tracks.first()
        val byHash = library.filter { it.contentHash != null }.associateBy { it.contentHash }
        val byRemoteId = library.filter { it.remoteId != null }.associateBy { it.remoteId }
        val taken = withContext(Dispatchers.Main) {
            // Anything started or edited since startup wins over the handoff.
            if (player.isPlaying || currentQueueKey() != pushBaseline) return@withContext false
            val hasLocal = player.queueEntries.isNotEmpty()
            if (!QueueHandoff.useRemote(remote, SyncBus.deviceId, hasLocal, localActivityMs)) return@withContext false
            val (tracks, index) = QueueHandoff.resolve(remote) { id ->
                id.contentHash?.let { byHash[it] } ?: byRemoteId[id.remoteId]
            } ?: return@withContext false
            val positionMs = (remote.positionSeconds * 1000).toLong()
            player.restoreQueue(tracks, index, positionMs)
            _positionMs.value = positionMs
            adoptQueueAsBaseline()
            rebuildUiState()
            Timber.i("Took over the queue from another device: %d tracks at index %d", tracks.size, index)
            true
        }
        // The phone now holds that queue, so its next restore isn't older than the server's copy.
        if (taken) settingsRepository.markQueueActivity()
    }

    // region Transport (delegates keep web playerStore semantics)

    fun playQueue(tracks: List<Track>, startIndex: Int) {
        startService()
        player.playQueue(tracks, startIndex)
    }

    fun togglePlay() {
        if (player.currentTrack != null) startService()
        player.togglePlay()
    }

    fun next() = player.nextTrack()
    fun previous() = player.previousTrack()
    fun jumpTo(index: Int) = player.jumpTo(index)
    fun reorderQueue(from: Int, to: Int) = player.reorderQueue(from, to)

    fun playNext(tracks: List<Track>) {
        startService()
        player.playNext(tracks)
    }

    fun addToQueue(tracks: List<Track>) {
        startService()
        player.addToQueue(tracks)
    }
    fun removeFromQueue(index: Int) = player.removeFromQueue(index)
    /** [sync] false (sign-out, account switch): not an edit, so no cleared queue goes out. */
    fun clearQueue(sync: Boolean = true) {
        closePlaySession()
        player.clearQueue()
        if (!sync) adoptQueueAsBaseline()
    }

    fun seekTo(positionMs: Long) {
        player.seekToMs(positionMs)
        _positionMs.value = positionMs
    }

    /**
     * Voice search (Assistant / Android Auto MEDIA_PLAY_FROM_SEARCH). Matches
     * title/artist/album — the same fields the library search filters on. An
     * empty query ("play some music") plays the whole library.
     */
    fun playFromSearch(query: String?) {
        appScope.launch {
            val all = libraryRepository.tracks.first().sortedWith(
                compareBy(String.CASE_INSENSITIVE_ORDER, Track::artist)
                    .thenBy(String.CASE_INSENSITIVE_ORDER, Track::title)
            )
            if (all.isEmpty()) return@launch
            val q = query?.trim()?.lowercase().orEmpty()
            val matches = if (q.isEmpty()) all else all.filter {
                it.title.lowercase().contains(q) ||
                    it.artist.lowercase().contains(q) ||
                    it.album.lowercase().contains(q)
            }
            val queue = matches.ifEmpty { all }
            withContext(Dispatchers.Main) { playQueue(queue, 0) }
            Timber.i("playFromSearch(%s): %d matches", query, matches.size)
        }
    }

    // endregion

    // region Settings (persist via DataStore; the collector applies to the engine)

    fun setVolume(volume: Float) {
        player.setMasterVolume(volume) // apply immediately for responsive dragging
        rebuildUiState() // the player fires no event for it, and the slider follows uiState
        appScope.launch { settingsRepository.setVolume(volume) }
    }

    fun toggleShuffle() {
        val next = !player.shuffleEnabled
        player.setShuffleEnabled(next)
        appScope.launch { settingsRepository.setShuffle(next) }
    }

    fun cycleRepeat() {
        val next = when (player.repeatModeDomain) {
            RepeatMode.OFF -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
        }
        player.setRepeatModeDomain(next)
        appScope.launch { settingsRepository.setRepeat(next) }
    }

    // endregion

    // region Sleep timer (sleepStore.ts)

    fun startSleepTimer(minutes: Int) {
        sleepJob?.cancel()
        val endsAt = System.currentTimeMillis() + minutes * 60_000L
        sleepJob = mainScope.launch {
            while (isActive) {
                val remaining = endsAt - System.currentTimeMillis()
                if (remaining <= 0) {
                    _sleepRemainingMs.value = null
                    if (player.currentTrack != null && player.isPlaying) player.togglePlay()
                    Timber.i("Sleep timer elapsed; paused playback")
                    break
                }
                _sleepRemainingMs.value = remaining
                delay(500)
            }
        }
    }

    fun cancelSleepTimer() {
        sleepJob?.cancel()
        sleepJob = null
        _sleepRemainingMs.value = null
    }

    // endregion

    private fun startService() {
        try {
            context.startService(Intent(context, PlaybackService::class.java))
        } catch (e: Exception) {
            Timber.e(e, "Failed to start playback service")
        }
    }
}
