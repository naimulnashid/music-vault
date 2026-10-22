package com.musicvault.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.musicvault.data.cloud.AuthRepository
import com.musicvault.data.repo.StatsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Feeds StatsScreen the merged play-event stream (local log + sync shadow) and the device names. */
@HiltViewModel
class StatsViewModel @Inject constructor(
    statsRepository: StatsRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    val data: StateFlow<StatsRepository.StatsData> = statsRepository.data
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StatsRepository.StatsData())

    private val _deviceNames = MutableStateFlow<Map<String, String>>(emptyMap())
    val deviceNames: StateFlow<Map<String, String>> = _deviceNames.asStateFlow()

    val thisDeviceId: String? get() = authRepository.deviceId()

    init {
        viewModelScope.launch { _deviceNames.value = authRepository.deviceNames() }
    }
}
