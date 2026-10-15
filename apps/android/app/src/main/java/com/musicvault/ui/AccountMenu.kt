package com.musicvault.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.data.cloud.AuthState
import com.musicvault.domain.model.ThemeMode
import com.musicvault.ui.components.Hairline
import com.musicvault.ui.theme.LocalVaultColors

/** Initial on a violet disc when signed in, a person glyph otherwise. */
@Composable
fun Avatar(email: String?, size: Int = 34) {
    val colors = LocalVaultColors.current
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(
                if (email != null) Brush.linearGradient(listOf(Color(0xFFA78BFA), Color(0xFF6D28D9)))
                else Brush.linearGradient(listOf(colors.surface2, colors.surface2)),
            ),
    ) {
        if (email != null) {
            Text(email.take(1).uppercase(), color = Color.White, fontSize = (size * 0.42f).sp, fontWeight = FontWeight.Bold)
        } else {
            Icon(Icons.Rounded.Person, null, tint = colors.textMuted, modifier = Modifier.size((size * 0.55f).dp))
        }
    }
}

/**
 * The account menu, dropping down under the avatar at the top right like the
 * desktop one: account and sync, Upload (the phone's top bar has no Upload
 * button), appearance, then Sign out.
 */
@Composable
fun AccountMenu(
    expanded: Boolean,
    mainViewModel: MainViewModel,
    onUpload: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val colors = LocalVaultColors.current
    val settings by mainViewModel.settings.collectAsStateWithLifecycle()
    val authViewModel: AuthViewModel = hiltViewModel()
    val authState by authViewModel.authState.collectAsStateWithLifecycle()

    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        offset = DpOffset(0.dp, 6.dp),
        shape = RoundedCornerShape(20.dp),
        containerColor = colors.surface,
        tonalElevation = 0.dp,
        shadowElevation = 3.dp,
        border = BorderStroke(1.dp, colors.border),
        modifier = Modifier.width(300.dp),
    ) {
        AccountSection(authViewModel, onClose = onDismiss)
        if (onUpload != null) {
            Hairline()
            MenuRow(Icons.Rounded.CloudUpload, "Upload music", tint = colors.accent) {
                onDismiss()
                onUpload()
            }
        }
        Hairline()
        Text(
            "APPEARANCE",
            color = colors.subtle,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 8.dp),
        )
        val mode = when {
            settings.followSystemTheme -> "system"
            settings.theme == ThemeMode.LIGHT -> "light"
            else -> "dark"
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(colors.surface2)
                .padding(4.dp),
        ) {
            ModeOption("Light", Icons.Rounded.LightMode, mode == "light", Modifier.weight(1f)) {
                mainViewModel.setFollowSystemTheme(false)
                mainViewModel.setTheme(ThemeMode.LIGHT)
            }
            ModeOption("Dark", Icons.Rounded.DarkMode, mode == "dark", Modifier.weight(1f)) {
                mainViewModel.setFollowSystemTheme(false)
                mainViewModel.setTheme(ThemeMode.DARK)
            }
            ModeOption("System", Icons.Rounded.PhoneAndroid, mode == "system", Modifier.weight(1f)) {
                mainViewModel.setFollowSystemTheme(true)
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { mainViewModel.setAmoled(!settings.amoled) }
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text("Pure black (AMOLED)", color = colors.text, fontSize = 14.sp)
                Text("Dark theme only", color = colors.subtle, fontSize = 12.sp)
            }
            Switch(
                checked = settings.amoled,
                onCheckedChange = { mainViewModel.setAmoled(it) },
                colors = SwitchDefaults.colors(checkedTrackColor = colors.accent, checkedThumbColor = Color.White),
            )
        }
        if (authState is AuthState.SignedIn) {
            Hairline()
            MenuRow(Icons.AutoMirrored.Rounded.Logout, "Sign out") {
                onDismiss()
                authViewModel.signOut()
            }
        }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, tint: Color? = null, onClick: () -> Unit) {
    val colors = LocalVaultColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 13.dp),
    ) {
        Icon(icon, null, tint = tint ?: colors.textMuted, modifier = Modifier.size(20.dp))
        Text(label, color = colors.text, fontSize = 14.sp)
    }
}

@Composable
private fun ModeOption(label: String, icon: ImageVector, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = LocalVaultColors.current
    val bg by animateColorAsState(if (selected) colors.surface else Color.Transparent, label = "modeBg")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .height(40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(bg)
            .clickable(onClick = onClick),
    ) {
        Icon(icon, null, tint = if (selected) colors.text else colors.textMuted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, color = if (selected) colors.text else colors.textMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}
