package com.musicvault.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.musicvault.data.repo.StatsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/** Feeds StatsScreen the merged play-event stream (local log + sync shadow). */
@HiltViewModel
class StatsViewModel @Inject constructor(statsRepository: StatsRepository) : ViewModel() {
    val data: StateFlow<StatsRepository.StatsData> = statsRepository.data
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StatsRepository.StatsData())
}
