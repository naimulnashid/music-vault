package com.musicvault.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import com.musicvault.ui.components.Hairline
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.data.cloud.AuthState
import com.musicvault.data.sync.SyncPhase
import com.musicvault.ui.theme.LocalVaultColors

/**
 * Top of the account menu, as on desktop: who is signed in (or Sign in), then
 * the sync state with Sync now. Sign out sits at the bottom of the menu.
 */
@Composable
fun AccountSection(authViewModel: AuthViewModel, onClose: () -> Unit) {
    val colors = LocalVaultColors.current
    val state by authViewModel.authState.collectAsStateWithLifecycle()
    var showDialog by remember { mutableStateOf(false) }

    when (val s = state) {
        AuthState.Disabled -> Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
        ) {
            Icon(Icons.Rounded.CloudOff, null, tint = colors.textMuted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(10.dp))
            Text("Music Vault needs an account, and this build has none configured", color = colors.textMuted, fontSize = 13.sp)
        }

        is AuthState.SignedIn -> {
            val sync by authViewModel.syncStatus.collectAsStateWithLifecycle()
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Avatar(s.email ?: "?", size = 44)
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        s.email ?: "Signed in",
                        color = colors.text,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text("Signed in", color = colors.textMuted, fontSize = 12.sp)
                }
            }
            Hairline()
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
            ) {
                Icon(
                    when (sync.phase) {
                        SyncPhase.OFFLINE -> Icons.Rounded.WifiOff
                        SyncPhase.ERROR -> Icons.Rounded.WarningAmber
                        else -> Icons.Rounded.Sync
                    },
                    null,
                    tint = when (sync.phase) {
                        SyncPhase.SYNCING -> colors.accent
                        SyncPhase.ERROR -> Color(0xFFFBBF24)
                        else -> colors.textMuted
                    },
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.size(12.dp))
                Text(
                    when (sync.phase) {
                        SyncPhase.SYNCING -> "Syncing…"
                        SyncPhase.OFFLINE -> "Offline, changes queued"
                        SyncPhase.ERROR -> "Sync issue, will retry"
                        SyncPhase.IDLE ->
                            if (sync.pendingOps > 0) "${sync.pendingOps} change${if (sync.pendingOps == 1) "" else "s"} queued" else "Everything synced"
                    },
                    color = colors.textMuted,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { authViewModel.syncNow() }, enabled = sync.phase != SyncPhase.SYNCING) {
                    Text("Sync now", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = colors.text)
                }
            }
        }

        else -> Box(Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .clip(CircleShape)
                    .background(colors.accent)
                    .clickable(enabled = state != AuthState.Loading) { showDialog = true },
            ) {
                Icon(Icons.AutoMirrored.Rounded.Login, null, tint = colors.accentFg, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(
                    if (state == AuthState.Loading) "Checking account…" else "Sign in",
                    color = colors.accentFg,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }

    if (showDialog) {
        AuthDialog(authViewModel, onDismiss = {
            showDialog = false
            onClose()
        })
    }
}

@Composable
private fun AuthDialog(authViewModel: AuthViewModel, onDismiss: () -> Unit) {
    val state by authViewModel.authState.collectAsStateWithLifecycle()
    val error by authViewModel.error.collectAsStateWithLifecycle()
    val notice by authViewModel.notice.collectAsStateWithLifecycle()
    val busy by authViewModel.busy.collectAsStateWithLifecycle()

    var signUpMode by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    // close once signed in
    if (state is AuthState.SignedIn) {
        authViewModel.clearMessages()
        onDismiss()
        return
    }

    val valid = email.isNotBlank() && password.length >= 6

    AlertDialog(
        onDismissRequest = {
            authViewModel.clearMessages()
            onDismiss()
        },
        title = { Text(if (signUpMode) "Create account" else "Sign in", fontWeight = FontWeight.SemiBold) },
        text = {
            Column {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = { Text("Email") },
                    singleLine = true,
                    enabled = !busy,
                )
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = { Text("Password (min 6)") },
                    singleLine = true,
                    enabled = !busy,
                    visualTransformation = PasswordVisualTransformation(),
                )
                error?.let {
                    Spacer(Modifier.size(8.dp))
                    Text(it, color = androidx.compose.ui.graphics.Color(0xFFF87171), fontSize = 12.sp)
                }
                notice?.let {
                    Spacer(Modifier.size(8.dp))
                    Text(it, color = LocalVaultColors.current.accent, fontSize = 12.sp)
                }
                Spacer(Modifier.size(4.dp))
                TextButton(onClick = {
                    authViewModel.clearMessages()
                    signUpMode = !signUpMode
                }, enabled = !busy) {
                    Text(
                        if (signUpMode) "Already have an account? Sign in" else "No account? Create one",
                        fontSize = 12.sp,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (signUpMode) authViewModel.signUp(email.trim(), password)
                    else authViewModel.signIn(email.trim(), password)
                },
                enabled = valid && !busy,
            ) { Text(if (busy) "Please wait…" else if (signUpMode) "Sign up" else "Sign in") }
        },
        dismissButton = {
            TextButton(onClick = {
                authViewModel.clearMessages()
                onDismiss()
            }, enabled = !busy) { Text("Cancel") }
        },
    )
}
