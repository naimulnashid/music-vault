package com.musicvault.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.musicvault.data.prefs.SettingsRepository
import com.musicvault.domain.model.Settings
import com.musicvault.domain.model.ThemeMode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
) : ViewModel() {

    val settings: StateFlow<Settings> = settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, Settings())

    fun setTheme(theme: ThemeMode) = viewModelScope.launch { settingsRepository.setTheme(theme) }

    fun setAmoled(amoled: Boolean) = viewModelScope.launch { settingsRepository.setAmoled(amoled) }

    fun setFollowSystemTheme(follow: Boolean) = viewModelScope.launch { settingsRepository.setFollowSystemTheme(follow) }
}
