package com.musicvault.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.musicvault.data.cloud.AuthRepository
import com.musicvault.data.cloud.AuthState
import com.musicvault.data.sync.SyncManager
import com.musicvault.data.sync.SyncStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val syncManager: SyncManager,
) : ViewModel() {

    /** Live sync engine status (phase, pending ops) for the account UI. */
    val syncStatus: StateFlow<SyncStatus> = syncManager.status

    val authState: StateFlow<AuthState> =
        if (com.musicvault.BuildConfig.DEMO) {
            // A stand-in account, so the avatar shows an initial instead of "not configured".
            MutableStateFlow(AuthState.SignedIn(userId = "demo", email = "you@example.com"))
        } else if (!authRepository.isConfigured) {
            MutableStateFlow(AuthState.Disabled)
        } else {
            authRepository.sessionStatus
                .map { status ->
                    when (status) {
                        is SessionStatus.Initializing -> AuthState.Loading
                        is SessionStatus.Authenticated -> {
                            val user = status.session.user
                            AuthState.SignedIn(userId = user?.id ?: "", email = user?.email)
                        }
                        else -> AuthState.SignedOut
                    }
                }
                .stateIn(viewModelScope, SharingStarted.Eagerly, AuthState.Loading)
        }

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun signIn(email: String, password: String, onSuccess: () -> Unit = {}) = run {
        _notice.value = null
        launchAuth(onSuccess) { authRepository.signIn(email, password) }
    }

    fun signUp(email: String, password: String) = launchAuth {
        val immediate = authRepository.signUp(email, password)
        if (!immediate) {
            _notice.value = "Check your email to confirm the account, then sign in."
        }
    }

    fun signOut() = launchAuth { authRepository.signOut() }

    fun syncNow() = syncManager.syncNow()

    fun clearMessages() {
        _error.value = null
        _notice.value = null
    }

    init {
        // refresh this device's last_seen_at once per app start when a
        // restored session comes back as authenticated
        if (authRepository.isConfigured) {
            viewModelScope.launch {
                authRepository.sessionStatus.first { it is SessionStatus.Authenticated }
                authRepository.registerDevice()
            }
        }
    }

    private fun launchAuth(onSuccess: () -> Unit = {}, block: suspend () -> Unit) {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            _error.value = null
            try {
                block()
                onSuccess()
            } catch (e: Exception) {
                _error.value = e.message ?: "Something went wrong."
            } finally {
                _busy.value = false
            }
        }
    }
}
