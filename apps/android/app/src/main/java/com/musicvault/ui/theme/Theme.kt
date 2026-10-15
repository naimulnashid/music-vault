package com.musicvault.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.musicvault.R
import com.musicvault.domain.model.ThemeMode

/**
 * Design tokens shared 1:1 with the desktop and web apps (index.css):
 * dark-first surfaces, one accent (Vibrant Violet #8B5CF6) and the Figtree
 * typeface. Every color used in the UI comes from here.
 */
data class VaultColors(
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val surface3: Color,
    val border: Color,
    val text: Color,
    val textMuted: Color,
    val subtle: Color,
    val accent: Color,
    val accentFg: Color,
    val accentSoft: Color,
    val danger: Color,
    val isDark: Boolean,
)

/** The one accent across all three apps. */
val Violet = Color(0xFF8B5CF6)

fun vaultColors(theme: ThemeMode, amoled: Boolean = false): VaultColors {
    val dark = theme == ThemeMode.DARK
    return when {
        dark && amoled -> VaultColors(
            bg = Color(0xFF000000),
            surface = Color(0xFF0B0B0D),
            surface2 = Color(0xFF151518),
            surface3 = Color(0xFF202024),
            border = Color(0x14FFFFFF),
            text = Color(0xFFF4F4F7),
            textMuted = Color(0xFFA2A2AE),
            subtle = Color(0xFF6F6F7C),
            accent = Violet,
            accentFg = Color.White,
            accentSoft = Violet.copy(alpha = 0.18f),
            danger = Color(0xFFF87171),
            isDark = true,
        )
        dark -> VaultColors(
            bg = Color(0xFF0D0D10),
            surface = Color(0xFF16161B),
            surface2 = Color(0xFF1F1F26),
            surface3 = Color(0xFF2A2A33),
            border = Color(0x14FFFFFF),
            text = Color(0xFFF4F4F7),
            textMuted = Color(0xFFA2A2AE),
            subtle = Color(0xFF6F6F7C),
            accent = Violet,
            accentFg = Color.White,
            accentSoft = Violet.copy(alpha = 0.18f),
            danger = Color(0xFFF87171),
            isDark = true,
        )
        else -> VaultColors(
            bg = Color(0xFFF6F6F9),
            surface = Color(0xFFFFFFFF),
            surface2 = Color(0xFFECECF1),
            surface3 = Color(0xFFDFDFE6),
            border = Color(0x17141428),
            text = Color(0xFF141419),
            textMuted = Color(0xFF5D5D6B),
            subtle = Color(0xFF8C8C99),
            accent = Violet,
            accentFg = Color.White,
            accentSoft = Violet.copy(alpha = 0.13f),
            danger = Color(0xFFDC2626),
            isDark = false,
        )
    }
}

val LocalVaultColors = staticCompositionLocalOf { vaultColors(ThemeMode.DARK) }

@OptIn(ExperimentalTextApi::class)
private fun figtree(weight: FontWeight) = Font(
    R.font.figtree,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

/** Figtree (variable), with the platform font filling in other scripts. */
val Figtree = FontFamily(
    figtree(FontWeight.Normal),
    figtree(FontWeight.Medium),
    figtree(FontWeight.SemiBold),
    figtree(FontWeight.Bold),
    figtree(FontWeight.ExtraBold),
)

private fun typography(): Typography {
    val base = Typography()
    fun TextStyle.f() = copy(fontFamily = Figtree)
    return base.copy(
        displayLarge = base.displayLarge.f(),
        displayMedium = base.displayMedium.f(),
        displaySmall = base.displaySmall.f(),
        headlineLarge = base.headlineLarge.f(),
        headlineMedium = base.headlineMedium.f(),
        headlineSmall = base.headlineSmall.f(),
        titleLarge = base.titleLarge.f(),
        titleMedium = base.titleMedium.f(),
        titleSmall = base.titleSmall.f(),
        bodyLarge = base.bodyLarge.f(),
        bodyMedium = base.bodyMedium.f(),
        bodySmall = base.bodySmall.f(),
        labelLarge = base.labelLarge.f(),
        labelMedium = base.labelMedium.f(),
        labelSmall = base.labelSmall.f(),
    )
}

private fun materialScheme(c: VaultColors): ColorScheme {
    val base = if (c.isDark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.accent,
        onPrimary = c.accentFg,
        primaryContainer = c.accentSoft,
        onPrimaryContainer = c.text,
        secondary = c.accent,
        onSecondary = c.accentFg,
        secondaryContainer = c.accentSoft,
        onSecondaryContainer = c.text,
        background = c.bg,
        onBackground = c.text,
        surface = c.surface,
        onSurface = c.text,
        surfaceVariant = c.surface2,
        onSurfaceVariant = c.textMuted,
        surfaceContainer = c.surface,
        surfaceContainerHigh = c.surface2,
        surfaceContainerHighest = c.surface3,
        surfaceContainerLow = c.surface,
        surfaceContainerLowest = c.bg,
        surfaceBright = c.surface3,
        outline = c.border,
        outlineVariant = c.border,
        error = c.danger,
    )
}

@Composable
fun MusicVaultTheme(
    theme: ThemeMode? = null,
    amoled: Boolean = false,
    content: @Composable () -> Unit,
) {
    val mode = theme ?: if (isSystemInDarkTheme()) ThemeMode.DARK else ThemeMode.LIGHT
    val colors = vaultColors(mode, amoled)

    CompositionLocalProvider(LocalVaultColors provides colors) {
        MaterialTheme(
            colorScheme = materialScheme(colors),
            typography = typography(),
            content = content,
        )
    }
}
