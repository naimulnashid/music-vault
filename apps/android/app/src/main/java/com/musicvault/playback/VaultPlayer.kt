package com.musicvault.playback

import android.content.Context
import android.media.AudioManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.exoplayer.ExoPlayer
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.File

private const val PRELOAD_LEAD_MS = 15_000L
private const val TICK_MS = 250L
private const val FADE_STEP_MS = 40L

/**
 * Native port of the web app's dual-element audio engine (audioEngine.ts +
 * useAudioEngine.ts + playerStore.ts).
 *
 * Two ExoPlayers share one audio session (so a single EQ/visualizer taps both).
 * The inactive player preloads the upcoming track; transitions either
 * hard-switch to it (gapless) or overlap with a volume ramp (crossfade),
 * exactly like the web implementation. Exposing it all through
 * [SimpleBasePlayer] makes the engine a real [Player], which is what gives us
 * the media notification, lock screen, Bluetooth/headset buttons and Android
 * Auto for free via MediaSession.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class VaultPlayer(
    context: Context,
    dataSourceFactory: androidx.media3.datasource.DataSource.Factory? = null,
    private val trackResolver: suspend (List<String>) -> List<Track>,
) : SimpleBasePlayer(Looper.getMainLooper()) {

    interface Callback {
        /** Fires when playback moves to a new queue entry (manual or automatic). */
        fun onTrackStarted(track: Track)

        /** Fires whenever the queue contents change. */
        fun onQueueChanged(trackIds: List<String>)

        /** Fires when the current song plays to its end, before the queue moves on or repeats it. */
        fun onTrackFinished(track: Track) {}

        /** Fires when the current song can't be loaded (preload failures stay silent). */
        fun onPlaybackFailed(track: Track, error: PlaybackException) {}
    }

    var callback: Callback? = null

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val queue = QueueState()
    private val eq = EqController()

    val audioSessionId: Int =
        (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).generateAudioSessionId()

    private val players: List<ExoPlayer> = List(2) { index ->
        ExoPlayer.Builder(context)
            .setLooper(Looper.getMainLooper())
            // NETWORK = CPU + Wi-Fi lock: songs stream/download from the vault
            // while the screen is off.
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setHandleAudioBecomingNoisy(true)
            .apply {
                // vault:// URIs resolve through the pinned copy or the auto-cache.
                dataSourceFactory?.let {
                    setMediaSourceFactory(
                        androidx.media3.exoplayer.source.DefaultMediaSourceFactory(context)
                            .setDataSourceFactory(it),
                    )
                }
            }
            .build()
            .apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(),
                    /* handleAudioFocus = */ true,
                )
                audioSessionId = this@VaultPlayer.audioSessionId
                addListener(createInternalListener(index))
            }
    }

    private var activeIndex = 0
    private var playWhenReadyFlag = false
    private var masterVolume = 0.8f
    private var repeat: RepeatMode = RepeatMode.OFF
    private var shuffleFlag = false
    private var gaplessEnabled = true
    private var crossfadeSeconds = 0

    private var preloadedUid: Long? = null
    private var fadeStartedForUid: Long? = null
    private var fadeEndsAtMs = 0L
    private var fadeRunnable: Runnable? = null
    private var lastStartedTrackId: String? = null

    private val activePlayer: ExoPlayer get() = players[activeIndex]
    private val inactivePlayer: ExoPlayer get() = players[1 - activeIndex]

    init {
        eq.attach(audioSessionId)
        handler.postDelayed(object : Runnable {
            override fun run() {
                tick()
                handler.postDelayed(this, TICK_MS)
            }
        }, TICK_MS)
    }

    // region Public engine API (used by PlaybackController / UI; all main thread)

    val queueEntries: List<QueueEntry> get() = queue.entries
    val currentQueueIndex: Int get() = queue.currentIndex
    val currentTrack: Track? get() = queue.currentTrack
    val repeatModeDomain: RepeatMode get() = repeat
    val shuffleEnabled: Boolean get() = shuffleFlag
    val volumeLevel: Float get() = masterVolume

    fun positionMsNow(): Long = if (queue.isEmpty) 0L else activePlayer.currentPosition.coerceAtLeast(0L)

    fun durationMsNow(): Long {
        if (queue.isEmpty) return 0L
        val playerDuration = activePlayer.duration
        if (playerDuration != C.TIME_UNSET && playerDuration > 0) return playerDuration
        return queue.currentTrack?.durationMs ?: 0L
    }

    fun playQueue(tracks: List<Track>, startIndex: Int) {
        if (tracks.isEmpty()) return
        queue.setQueue(tracks, startIndex, shuffleFlag)
        playWhenReadyFlag = true
        loadCurrent(startPositionMs = 0L)
        notifyQueueChanged()
    }

    /** Restores the persisted queue paused at a saved position (web restoreTrack). */
    fun restoreQueue(tracks: List<Track>, index: Int, positionMs: Long) {
        if (tracks.isEmpty()) return
        queue.restore(tracks, index)
        playWhenReadyFlag = false
        lastStartedTrackId = queue.currentTrack?.id // don't count a restore as a play
        loadCurrent(startPositionMs = positionMs)
        notifyQueueChanged()
    }

    fun togglePlay() {
        if (queue.isEmpty) return
        setPlayWhenReadyInternal(!playWhenReadyFlag)
        invalidateState()
    }

    fun nextTrack() {
        when (val result = queue.next(repeat)) {
            is AdvanceResult.Move -> {
                playWhenReadyFlag = true
                loadCurrent(0L)
            }
            AdvanceResult.RestartCurrent -> {
                finalizeFade()
                activePlayer.seekTo(0)
                setPlayWhenReadyInternal(true)
            }
            AdvanceResult.EndOfQueue -> setPlayWhenReadyInternal(false)
            AdvanceResult.None -> {}
        }
        invalidateState()
    }

    fun previousTrack() {
        when (queue.previous(positionMsNow())) {
            is AdvanceResult.Move -> {
                playWhenReadyFlag = true
                loadCurrent(0L)
            }
            AdvanceResult.RestartCurrent -> {
                finalizeFade()
                activePlayer.seekTo(0)
            }
            else -> {}
        }
        invalidateState()
    }

    fun jumpTo(index: Int) {
        if (queue.jumpTo(index)) {
            playWhenReadyFlag = true
            loadCurrent(0L)
            invalidateState()
        }
    }

    /** "Play next": right after the current song (starts playing if idle). */
    fun playNext(tracks: List<Track>) {
        if (queue.isEmpty) return playQueue(tracks, 0)
        queue.insert(tracks, queue.currentIndex + 1)
        preloadedUid = null // the upcoming song changed
        notifyQueueChanged()
        invalidateState()
    }

    /** "Add to queue": at the end (starts playing if idle). */
    fun addToQueue(tracks: List<Track>) {
        if (queue.isEmpty) return playQueue(tracks, 0)
        queue.insert(tracks, queue.entries.size)
        notifyQueueChanged()
        invalidateState()
    }

    fun reorderQueue(fromIndex: Int, toIndex: Int) {
        queue.reorder(fromIndex, toIndex)
        preloadedUid = null // ordering changed; preloaded item may no longer be next
        notifyQueueChanged()
        invalidateState()
    }

    fun removeFromQueue(index: Int) {
        when (val result = queue.removeAt(index)) {
            RemoveResult.QueueCleared -> stopPlayback()
            is RemoveResult.CurrentRemoved -> loadCurrent(0L)
            RemoveResult.IndexShifted -> preloadedUid = null
            RemoveResult.None -> return
        }
        notifyQueueChanged()
        invalidateState()
    }

    fun clearQueue() {
        queue.clear()
        stopPlayback()
        notifyQueueChanged()
        invalidateState()
    }

    fun seekToMs(positionMs: Long) {
        if (queue.isEmpty) return
        // Seeking cancels any in-progress crossfade and snaps to the active track (web seek()).
        finalizeFade()
        inactivePlayer.pause()
        activePlayer.seekTo(positionMs.coerceAtLeast(0L))
        invalidateState()
    }

    fun setMasterVolume(volume: Float) {
        masterVolume = volume.coerceIn(0f, 1f)
        if (fadeRunnable == null) {
            activePlayer.volume = masterVolume
        }
        invalidateState()
    }

    fun setRepeatModeDomain(mode: RepeatMode) {
        repeat = mode
        invalidateState()
    }

    fun setShuffleEnabled(enabled: Boolean) {
        shuffleFlag = enabled
        invalidateState()
    }

    fun setGapless(enabled: Boolean) {
        gaplessEnabled = enabled
    }

    fun setCrossfadeSeconds(seconds: Int) {
        crossfadeSeconds = seconds.coerceIn(0, 12)
    }

    fun setEqBands(bands: List<Float>) = eq.setBands(bands)

    // endregion

    // region Internal engine

    private fun createInternalListener(playerIndex: Int) = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playerIndex != activeIndex) return
            if (playbackState == Player.STATE_ENDED) onActiveEnded()
            invalidateState()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (playerIndex == activeIndex) invalidateState()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            // Sync external pauses (audio focus loss, headphones unplugged) into our state.
            if (playerIndex == activeIndex &&
                !playWhenReady &&
                reason != Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST &&
                playWhenReadyFlag
            ) {
                Timber.i("Playback paused externally (reason=%d)", reason)
                playWhenReadyFlag = false
                finalizeFade()
                inactivePlayer.pause()
                invalidateState()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            Timber.e(error, "Player %d error on %s", playerIndex, queue.currentTrack?.fileName)
            if (playerIndex == activeIndex) {
                // A paused restore that fails stays quiet; pressing play retries and reports.
                val wanted = playWhenReadyFlag
                playWhenReadyFlag = false
                invalidateState()
                if (wanted) queue.currentTrack?.let { callback?.onPlaybackFailed(it, error) }
            }
        }
    }

    private fun loadCurrent(startPositionMs: Long) {
        val track = queue.currentTrack ?: return
        finalizeFade()
        inactivePlayer.pause()
        preloadedUid = null
        fadeStartedForUid = null
        fadeEndsAtMs = 0L

        activePlayer.volume = masterVolume
        activePlayer.setMediaItem(buildMediaItem(track))
        activePlayer.prepare()
        if (startPositionMs > 0) activePlayer.seekTo(startPositionMs)
        activePlayer.playWhenReady = playWhenReadyFlag

        if (lastStartedTrackId != track.id) {
            lastStartedTrackId = track.id
            callback?.onTrackStarted(track)
        }
        invalidateState()
    }

    private fun stopPlayback() {
        finalizeFade()
        players.forEach {
            it.stop()
            it.clearMediaItems()
        }
        playWhenReadyFlag = false
        preloadedUid = null
        lastStartedTrackId = null
    }

    private fun setPlayWhenReadyInternal(playWhenReady: Boolean) {
        playWhenReadyFlag = playWhenReady
        if (queue.isEmpty) return
        if (playWhenReady) {
            // After a failed load the player sits idle with the error and play() alone
            // would show "playing" at 0:00 forever; preparing again retries the load.
            if (activePlayer.playerError != null) activePlayer.prepare()
            activePlayer.play()
        } else {
            finalizeFade()
            players.forEach { it.pause() }
        }
    }

    /** Periodic driver for preload + crossfade triggers (web handleTick). */
    private fun tick() {
        if (queue.isEmpty || !activePlayer.isPlaying) return
        val duration = activePlayer.duration
        if (duration == C.TIME_UNSET || duration <= 0) return

        val nextIndex = queue.nextIndexForAdvance(repeat) ?: return
        val nextEntry = queue.entries.getOrNull(nextIndex) ?: return
        val remaining = duration - activePlayer.currentPosition
        val wantSeamless = gaplessEnabled || crossfadeSeconds > 0
        val rampDone = System.currentTimeMillis() >= fadeEndsAtMs

        if (wantSeamless && rampDone && remaining < PRELOAD_LEAD_MS && preloadedUid != nextEntry.uid) {
            preloadNext(nextEntry)
        }

        val xfMs = crossfadeSeconds * 1000L
        val currentUid = queue.entries.getOrNull(queue.currentIndex)?.uid
        if (xfMs > 0 && remaining in 151..xfMs && fadeStartedForUid != currentUid) {
            fadeStartedForUid = currentUid
            if (preloadedUid != nextEntry.uid) preloadNext(nextEntry)
            startCrossfade(minOf(xfMs, remaining), nextIndex)
        }
    }

    private fun preloadNext(entry: QueueEntry) {
        inactivePlayer.volume = 0f
        inactivePlayer.setMediaItem(buildMediaItem(entry.track))
        inactivePlayer.prepare()
        inactivePlayer.playWhenReady = false
        preloadedUid = entry.uid
        Timber.d("Preloaded next track: %s", entry.track.title)
    }

    /** Overlap the preloaded next track with the current one (web crossfadeToNext). */
    private fun startCrossfade(durationMs: Long, nextIndex: Int) {
        val fromPlayer = activePlayer
        val toPlayer = inactivePlayer
        val nextTrack = queue.entries[nextIndex].track

        toPlayer.seekTo(0)
        toPlayer.volume = 0f
        toPlayer.play()

        activeIndex = 1 - activeIndex
        queue.markAdvancedTo(nextIndex)
        preloadedUid = null
        fadeEndsAtMs = System.currentTimeMillis() + durationMs + 200

        val startedAt = System.currentTimeMillis()
        fadeRunnable?.let { handler.removeCallbacks(it) }
        val runnable = object : Runnable {
            override fun run() {
                val t = ((System.currentTimeMillis() - startedAt).toFloat() / durationMs).coerceIn(0f, 1f)
                fromPlayer.volume = masterVolume * (1f - t)
                toPlayer.volume = masterVolume * t
                if (t < 1f) {
                    handler.postDelayed(this, FADE_STEP_MS)
                } else {
                    fromPlayer.pause()
                    fromPlayer.volume = 0f
                    toPlayer.volume = masterVolume
                    fadeRunnable = null
                }
            }
        }
        fadeRunnable = runnable
        handler.post(runnable)

        if (lastStartedTrackId != nextTrack.id) {
            lastStartedTrackId = nextTrack.id
            callback?.onTrackStarted(nextTrack)
        }
        Timber.d("Crossfading %.1fs into %s", durationMs / 1000f, nextTrack.title)
        invalidateState()
    }

    /** Snap any in-progress fade to its end state (web finalizeFade). */
    private fun finalizeFade() {
        fadeRunnable?.let { handler.removeCallbacks(it) }
        fadeRunnable = null
        activePlayer.volume = masterVolume
        inactivePlayer.volume = 0f
    }

    private fun onActiveEnded() {
        queue.currentTrack?.let { callback?.onTrackFinished(it) }
        if (repeat == RepeatMode.ONE) {
            activePlayer.seekTo(0)
            activePlayer.play()
            return
        }
        val nextIndex = queue.nextIndexForAdvance(repeat)
        val nextEntry = nextIndex?.let { queue.entries.getOrNull(it) }
        if (gaplessEnabled && nextEntry != null && preloadedUid == nextEntry.uid) {
            hardSwitchToPreloaded(nextIndex)
        } else {
            nextTrack()
        }
    }

    /** Instant switch to the preloaded next track (web hardSwitchToPreloaded). */
    private fun hardSwitchToPreloaded(nextIndex: Int) {
        finalizeFade()
        val fromPlayer = activePlayer
        val toPlayer = inactivePlayer
        activeIndex = 1 - activeIndex
        queue.markAdvancedTo(nextIndex)
        preloadedUid = null
        fadeStartedForUid = null

        toPlayer.volume = masterVolume
        toPlayer.seekTo(0)
        toPlayer.play()
        fromPlayer.pause()

        val track = queue.currentTrack
        if (track != null && lastStartedTrackId != track.id) {
            lastStartedTrackId = track.id
            callback?.onTrackStarted(track)
        }
        invalidateState()
    }

    private fun notifyQueueChanged() {
        callback?.onQueueChanged(queue.entries.map { it.track.id })
    }

    private fun buildMediaItem(track: Track): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .apply {
                track.artworkPath?.let { setArtworkUri(Uri.fromFile(File(it))) }
            }
            .build()
        return MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(track.uri)
            .setMediaMetadata(metadata)
            .build()
    }

    // endregion

    // region SimpleBasePlayer implementation

    private val permanentCommands = Player.Commands.Builder()
        .addAll(
            Player.COMMAND_PLAY_PAUSE,
            Player.COMMAND_PREPARE,
            Player.COMMAND_STOP,
            Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
            Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
            Player.COMMAND_SEEK_BACK,
            Player.COMMAND_SEEK_FORWARD,
            Player.COMMAND_SEEK_TO_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_NEXT,
            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_PREVIOUS,
            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
            Player.COMMAND_GET_TIMELINE,
            Player.COMMAND_GET_METADATA,
            Player.COMMAND_GET_VOLUME,
            Player.COMMAND_SET_REPEAT_MODE,
            Player.COMMAND_SET_SHUFFLE_MODE,
            Player.COMMAND_SET_MEDIA_ITEM,
            Player.COMMAND_CHANGE_MEDIA_ITEMS,
            Player.COMMAND_GET_AUDIO_ATTRIBUTES,
            Player.COMMAND_RELEASE,
        )
        .build()

    override fun getState(): State {
        val builder = State.Builder()
            .setAvailableCommands(permanentCommands)
            .setShuffleModeEnabled(shuffleFlag)
            .setRepeatMode(
                when (repeat) {
                    RepeatMode.OFF -> Player.REPEAT_MODE_OFF
                    RepeatMode.ONE -> Player.REPEAT_MODE_ONE
                    RepeatMode.ALL -> Player.REPEAT_MODE_ALL
                }
            )
            .setVolume(masterVolume)

        if (queue.isEmpty) {
            builder
                .setPlaybackState(Player.STATE_IDLE)
                .setPlayWhenReady(playWhenReadyFlag, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            return builder.build()
        }

        val playlist = queue.entries.mapIndexed { index, entry ->
            val durationMs = if (index == queue.currentIndex) durationMsNow() else entry.track.durationMs
            MediaItemData.Builder(entry.uid)
                .setMediaItem(buildMediaItem(entry.track))
                .setDurationUs(if (durationMs > 0) durationMs * 1000 else C.TIME_UNSET)
                .build()
        }

        val playbackState = when (activePlayer.playbackState) {
            Player.STATE_BUFFERING -> Player.STATE_BUFFERING
            // ENDED is transient (we advance immediately); IDLE means not yet prepared.
            else -> Player.STATE_READY
        }

        builder
            .setPlaylist(playlist)
            .setCurrentMediaItemIndex(queue.currentIndex.coerceAtLeast(0))
            .setContentPositionMs(PositionSupplier { positionMsNow() })
            .setIsLoading(activePlayer.isLoading)
            .setPlaybackState(playbackState)
            .setPlayWhenReady(playWhenReadyFlag, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        return builder.build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        setPlayWhenReadyInternal(playWhenReady)
        return Futures.immediateVoidFuture()
    }

    override fun handlePrepare(): ListenableFuture<*> {
        if (!queue.isEmpty && activePlayer.playbackState == Player.STATE_IDLE) {
            activePlayer.prepare()
        }
        return Futures.immediateVoidFuture()
    }

    override fun handleStop(): ListenableFuture<*> {
        setPlayWhenReadyInternal(false)
        return Futures.immediateVoidFuture()
    }

    override fun handleRelease(): ListenableFuture<*> {
        fadeRunnable?.let { handler.removeCallbacks(it) }
        handler.removeCallbacksAndMessages(null)
        eq.release()
        players.forEach { it.release() }
        return Futures.immediateVoidFuture()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        when (seekCommand) {
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> nextTrack()
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> previousTrack()
            Player.COMMAND_SEEK_TO_MEDIA_ITEM ->
                if (mediaItemIndex == queue.currentIndex) {
                    seekToMs(positionMs.coerceAtLeast(0L))
                } else {
                    jumpTo(mediaItemIndex)
                }
            else -> seekToMs(positionMs.coerceAtLeast(0L))
        }
        return Futures.immediateVoidFuture()
    }

    override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
        repeat = when (repeatMode) {
            Player.REPEAT_MODE_ONE -> RepeatMode.ONE
            Player.REPEAT_MODE_ALL -> RepeatMode.ALL
            else -> RepeatMode.OFF
        }
        return Futures.immediateVoidFuture()
    }

    override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> {
        shuffleFlag = shuffleModeEnabled
        return Futures.immediateVoidFuture()
    }

    override fun handleSetMediaItems(
        mediaItems: MutableList<MediaItem>,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<*> {
        // Requests from external controllers (Android Auto, Assistant). Resolve
        // media ids back to library tracks, then start the queue.
        val future = SettableFuture.create<Unit>()
        val ids = mediaItems.map { it.mediaId }
        scope.launch {
            try {
                val tracks = trackResolver(ids)
                if (tracks.isNotEmpty()) {
                    val index = if (startIndex == C.INDEX_UNSET) 0 else startIndex.coerceIn(0, tracks.size - 1)
                    queue.setQueue(tracks, index, shuffle = false)
                    playWhenReadyFlag = true
                    loadCurrent(if (startPositionMs == C.TIME_UNSET) 0L else startPositionMs.coerceAtLeast(0L))
                    notifyQueueChanged()
                } else {
                    Timber.w("setMediaItems could not resolve any of %d ids", ids.size)
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to resolve media items")
            } finally {
                future.set(Unit)
            }
        }
        return future
    }

    // endregion
}
