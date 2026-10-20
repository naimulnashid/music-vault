package com.musicvault.ui.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.musicvault.data.prefs.SettingsRepository
import com.musicvault.domain.model.Settings
import com.musicvault.domain.model.Track
import com.musicvault.playback.PlaybackController
import com.musicvault.playback.PlaybackUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PlayerViewModel @Inject constructor(
    private val controller: PlaybackController,
    private val settingsRepository: SettingsRepository,
) : ViewModel() {

    val uiState: StateFlow<PlaybackUiState> = controller.uiState
    val positionMs: StateFlow<Long> = controller.positionMs
    val sleepRemainingMs: StateFlow<Long?> = controller.sleepRemainingMs
    val playbackErrors: kotlinx.coroutines.flow.SharedFlow<String> = controller.playbackErrors

    val settings: StateFlow<Settings> = settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, Settings())

    val audioSessionId: Int get() = controller.audioSessionId

    fun playQueue(tracks: List<Track>, startIndex: Int) = controller.playQueue(tracks, startIndex)
    fun togglePlay() = controller.togglePlay()
    fun next() = controller.next()
    fun previous() = controller.previous()
    fun seekTo(positionMs: Long) = controller.seekTo(positionMs)
    fun jumpTo(index: Int) = controller.jumpTo(index)
    fun reorderQueue(from: Int, to: Int) = controller.reorderQueue(from, to)
    fun playNext(tracks: List<Track>) = controller.playNext(tracks)
    fun addToQueue(tracks: List<Track>) = controller.addToQueue(tracks)
    fun removeFromQueue(index: Int) = controller.removeFromQueue(index)
    fun clearQueue() = controller.clearQueue()
    fun toggleShuffle() = controller.toggleShuffle()
    fun cycleRepeat() = controller.cycleRepeat()
    fun setVolume(volume: Float) = controller.setVolume(volume)

    fun startSleepTimer(minutes: Int) = controller.startSleepTimer(minutes)
    fun cancelSleepTimer() = controller.cancelSleepTimer()

    fun setEqPreset(preset: String) = viewModelScope.launch { settingsRepository.setEqPreset(preset) }
    fun setEqBands(bands: List<Float>) = viewModelScope.launch { settingsRepository.setEqBands(bands) }
    fun setGapless(enabled: Boolean) = viewModelScope.launch { settingsRepository.setGapless(enabled) }
    fun setCrossfadeSeconds(seconds: Int) = viewModelScope.launch { settingsRepository.setCrossfadeSeconds(seconds) }
}
