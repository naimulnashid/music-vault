package com.musicvault.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.musicvault.data.sync.SyncBus
import com.musicvault.data.sync.SyncOpPayload
import com.musicvault.domain.model.AccentColor
import com.musicvault.domain.model.Eq
import com.musicvault.domain.model.RepeatMode
import com.musicvault.domain.model.Settings
import com.musicvault.domain.model.ThemeMode
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** Replaces the web app's settings store + localStorage keys, persisted via DataStore. */
@Singleton
class SettingsRepository @Inject constructor(@ApplicationContext private val context: Context) {

    private object Keys {
        val THEME = stringPreferencesKey("theme")
        val ACCENT = stringPreferencesKey("accent")
        val AMOLED = booleanPreferencesKey("amoled")
        val FOLLOW_SYSTEM = booleanPreferencesKey("followSystemTheme")
        val EQ_PRESET = stringPreferencesKey("eqPreset")
        val EQ_BANDS = stringPreferencesKey("eqBands")
        val VOLUME = floatPreferencesKey("volume")
        val SHUFFLE = booleanPreferencesKey("shuffle")
        val REPEAT = stringPreferencesKey("repeat")
        val GAPLESS = booleanPreferencesKey("gapless")
        val CROSSFADE = intPreferencesKey("crossfadeSeconds")

        // Last playback snapshot (queue itself lives in the Room queue_items table).
        val LAST_QUEUE_INDEX = intPreferencesKey("lastQueueIndex")
        val LAST_POSITION_MS = longPreferencesKey("lastPositionMs")

        // Imported SAF tree uris, one per granted folder, separated by newline.
        val IMPORTED_TREES = stringPreferencesKey("importedTrees")
    }

    val settings: Flow<Settings> = context.dataStore.data.map { prefs -> prefs.toSettings() }

    suspend fun current(): Settings = settings.first()

    private fun Preferences.toSettings(): Settings {
        val defaults = Settings()
        val bands = this[Keys.EQ_BANDS]
            ?.split(',')
            ?.mapNotNull { it.trim().toFloatOrNull() }
            ?.takeIf { it.size == Eq.FREQS.size }
        return Settings(
            theme = this[Keys.THEME]?.toEnumOrNull<ThemeMode>() ?: defaults.theme,
            accent = this[Keys.ACCENT]?.toEnumOrNull<AccentColor>() ?: defaults.accent,
            amoled = this[Keys.AMOLED] ?: defaults.amoled,
            followSystemTheme = this[Keys.FOLLOW_SYSTEM] ?: defaults.followSystemTheme,
            eqPreset = this[Keys.EQ_PRESET] ?: defaults.eqPreset,
            eqBands = bands ?: defaults.eqBands,
            volume = this[Keys.VOLUME] ?: defaults.volume,
            shuffle = this[Keys.SHUFFLE] ?: defaults.shuffle,
            repeat = this[Keys.REPEAT]?.toEnumOrNull<RepeatMode>() ?: defaults.repeat,
            gapless = this[Keys.GAPLESS] ?: defaults.gapless,
            crossfadeSeconds = this[Keys.CROSSFADE] ?: defaults.crossfadeSeconds,
        )
    }

    suspend fun setTheme(theme: ThemeMode) {
        edit { it[Keys.THEME] = theme.name }
        pushGlobal("theme", JsonPrimitive(theme.name.lowercase()))
    }

    suspend fun setAccent(accent: AccentColor) {
        edit { it[Keys.ACCENT] = accent.name }
        pushGlobal("accent", JsonPrimitive(accent.name.lowercase()))
    }

    // Device-look preferences: local only, never synced (each device picks its
    // own AMOLED / follow-system choice; the synced theme stays dark/light).
    suspend fun setAmoled(amoled: Boolean) = edit { it[Keys.AMOLED] = amoled }
    suspend fun setFollowSystemTheme(follow: Boolean) = edit { it[Keys.FOLLOW_SYSTEM] = follow }

    suspend fun setVolume(volume: Float) {
        edit { it[Keys.VOLUME] = volume.coerceIn(0f, 1f) }
        pushDevice("volume", JsonPrimitive(volume.coerceIn(0f, 1f)))
    }

    suspend fun setShuffle(shuffle: Boolean) {
        edit { it[Keys.SHUFFLE] = shuffle }
        pushGlobal("shuffle", JsonPrimitive(shuffle))
    }

    suspend fun setRepeat(repeat: RepeatMode) {
        edit { it[Keys.REPEAT] = repeat.name }
        pushGlobal("repeat", JsonPrimitive(repeat.name.lowercase()))
    }

    suspend fun setGapless(gapless: Boolean) {
        edit { it[Keys.GAPLESS] = gapless }
        pushGlobal("gapless", JsonPrimitive(gapless))
    }

    suspend fun setCrossfadeSeconds(seconds: Int) {
        edit { it[Keys.CROSSFADE] = seconds.coerceIn(0, 12) }
        pushGlobal("crossfadeDuration", JsonPrimitive(seconds.coerceIn(0, 12)))
    }

    suspend fun setEqPreset(preset: String) {
        edit {
            it[Keys.EQ_PRESET] = preset
            Eq.PRESETS[preset]?.let { bands -> it[Keys.EQ_BANDS] = bands.joinToString(",") }
        }
        pushDevice("eqPreset", JsonPrimitive(preset))
        Eq.PRESETS[preset]?.let { bands -> pushDevice("eqBands", bands.toJsonArray()) }
    }

    suspend fun setEqBands(bands: List<Float>) {
        edit {
            it[Keys.EQ_PRESET] = Eq.CUSTOM
            it[Keys.EQ_BANDS] = bands.joinToString(",")
        }
        pushDevice("eqPreset", JsonPrimitive(Eq.CUSTOM))
        pushDevice("eqBands", bands.toJsonArray())
    }

    // ---- sync integration (Phase 6) -------------------------------------------
    // Setter methods above enqueue a setting.set op with the desktop store's key
    // names and value shapes (theme "dark", repeat "off", crossfadeDuration int…)
    // so all clients read each other's writes. applyRemoteSetting is the pull
    // path: it writes DataStore directly and never re-enqueues.

    /** Which settings sync account-wide vs per-device (same split as desktop). */
    private fun pushGlobal(key: String, value: JsonElement) =
        SyncBus.enqueue(SyncOpPayload.SettingSet("global", key, value, SyncBus.nowIso()))

    private fun pushDevice(key: String, value: JsonElement) {
        val deviceId = SyncBus.deviceId ?: return // device not registered yet — stays local
        SyncBus.enqueue(SyncOpPayload.SettingSet(deviceId, key, value, SyncBus.nowIso()))
    }

    private fun List<Float>.toJsonArray(): JsonElement = JsonArray(map { JsonPrimitive(it) })

    /** Applies a pulled remote setting; unknown keys/values are ignored. */
    suspend fun applyRemoteSetting(key: String, value: JsonElement) {
        val primitive = value as? JsonPrimitive
        when (key) {
            "theme" -> primitive?.contentOrNull?.uppercase()?.toEnumOrNull<ThemeMode>()
                ?.let { theme -> edit { it[Keys.THEME] = theme.name } }
            "accent" -> primitive?.contentOrNull?.uppercase()?.toEnumOrNull<AccentColor>()
                ?.let { accent -> edit { it[Keys.ACCENT] = accent.name } }
            "shuffle" -> primitive?.booleanOrNull?.let { v -> edit { it[Keys.SHUFFLE] = v } }
            "repeat" -> primitive?.contentOrNull?.uppercase()?.toEnumOrNull<RepeatMode>()
                ?.let { repeat -> edit { it[Keys.REPEAT] = repeat.name } }
            "gapless" -> primitive?.booleanOrNull?.let { v -> edit { it[Keys.GAPLESS] = v } }
            "crossfadeDuration" -> primitive?.intOrNull?.let { v -> edit { it[Keys.CROSSFADE] = v.coerceIn(0, 12) } }
            "volume" -> primitive?.floatOrNull?.let { v -> edit { it[Keys.VOLUME] = v.coerceIn(0f, 1f) } }
            "eqPreset" -> primitive?.contentOrNull?.let { v -> edit { it[Keys.EQ_PRESET] = v } }
            "eqBands" -> (value as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.floatOrNull }
                ?.takeIf { it.size == Eq.FREQS.size }
                ?.let { bands -> edit { it[Keys.EQ_BANDS] = bands.joinToString(",") } }
        }
    }

    suspend fun saveLastPlayback(queueIndex: Int, positionMs: Long) = edit {
        it[Keys.LAST_QUEUE_INDEX] = queueIndex
        it[Keys.LAST_POSITION_MS] = positionMs
    }

    suspend fun lastPlayback(): Pair<Int, Long> {
        val prefs = context.dataStore.data.first()
        return (prefs[Keys.LAST_QUEUE_INDEX] ?: -1) to (prefs[Keys.LAST_POSITION_MS] ?: 0L)
    }

    val importedTreeUris: Flow<List<String>> = context.dataStore.data.map { prefs ->
        prefs[Keys.IMPORTED_TREES]?.split('\n')?.filter { it.isNotBlank() } ?: emptyList()
    }

    suspend fun addImportedTreeUri(uri: String) = edit { prefs ->
        val existing = prefs[Keys.IMPORTED_TREES]?.split('\n')?.filter { it.isNotBlank() } ?: emptyList()
        if (uri !in existing) prefs[Keys.IMPORTED_TREES] = (existing + uri).joinToString("\n")
    }

    private suspend fun edit(block: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        try {
            context.dataStore.edit(block)
        } catch (e: Exception) {
            Timber.e(e, "Failed to persist settings")
        }
    }

    private inline fun <reified T : Enum<T>> String.toEnumOrNull(): T? =
        enumValues<T>().firstOrNull { it.name == this }
}
