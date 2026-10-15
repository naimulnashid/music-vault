package com.musicvault.playback

import android.content.Context
import android.content.Intent
import androidx.media3.common.Player
import com.musicvault.data.db.QueueDao
import com.musicvault.data.prefs.SettingsRepository
import com.musicvault.data.repo.HistoryRepository
import com.musicvault.data.repo.LibraryRepository
import com.musicvault.data.repo.StatsRepository
import com.musicvault.di.ApplicationScope
import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Settings
import com.musicvault.domain.model.Track
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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
    vaultDataSourceFactory: VaultDataSourceFactory,
) {
    val player: VaultPlayer = VaultPlayer(context, vaultDataSourceFactory) { ids ->
        libraryRepository.getTracksByIds(ids)
    }

    private val mainScope = CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.Main)

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

    /** One listening session of one track, for the play-event stream (Phase 7). */
    private class PlaySession(val track: Track, val startedAtMs: Long) {
        var seconds: Long = 0
    }

    private var playSession: PlaySession? = null

    /** Closes the running session and records its play event. */
    private fun closePlaySession() {
        val session = playSession ?: return
        playSession = null
        appScope.launch { statsRepository.recordSession(session.track, session.startedAtMs, session.seconds) }
    }

    init {
        player.callback = object : VaultPlayer.Callback {
            override fun onTrackStarted(track: Track) {
                closePlaySession()
                playSession = PlaySession(track, System.currentTimeMillis())
                appScope.launch { historyRepository.recordPlay(track.id) }
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
                        playSession?.let { if (it.track.id == track.id) it.seconds += 1 }
                        appScope.launch {
                            historyRepository.addListenSeconds(track.id, 1)
                            settingsRepository.saveLastPlayback(index, position)
                        }
                    }
                }
            }
        }
    }

    private fun rebuildUiState() {
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

    /** Restores queue + position from the previous session, paused (web loadLastPlayback). */
    private fun restoreLastSession() {
        appScope.launch {
            try {
                val queueIds = queueDao.getQueue().map { it.trackId }
                if (queueIds.isEmpty()) return@launch
                val tracks = libraryRepository.getTracksByIds(queueIds)
                if (tracks.isEmpty()) return@launch
                val (savedIndex, savedPosition) = settingsRepository.lastPlayback()
                // Some queued tracks may have been removed since; re-locate by id.
                val savedId = queueIds.getOrNull(savedIndex)
                val index = tracks.indexOfFirst { it.id == savedId }.takeIf { it >= 0 }
                    ?: savedIndex.coerceIn(0, tracks.size - 1)
                withContext(Dispatchers.Main) {
                    player.restoreQueue(tracks, index, savedPosition)
                    _positionMs.value = savedPosition
                    rebuildUiState()
                }
                Timber.i("Restored queue of %d tracks at index %d", tracks.size, index)
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore last session")
            }
        }
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
    fun clearQueue() = player.clearQueue()

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
