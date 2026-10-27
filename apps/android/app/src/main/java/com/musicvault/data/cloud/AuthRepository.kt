package com.musicvault.data.cloud

import android.content.Context
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import timber.log.Timber
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/** Auth state exposed to the UI — a simplified view of supabase-kt's SessionStatus. */
sealed interface AuthState {
    /** No Supabase credentials configured: cloud features hidden. */
    data object Disabled : AuthState
    data object Loading : AuthState
    data object SignedOut : AuthState
    data class SignedIn(val userId: String, val email: String?) : AuthState
}

@Serializable
data class DeviceRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    val name: String,
    val platform: String,
    @SerialName("last_seen_at") val lastSeenAt: String,
)

@Serializable
private data class DeviceName(val id: String, val name: String)

@Serializable
private data class NewDevice(
    @SerialName("user_id") val userId: String,
    val name: String,
    val platform: String,
)

@Singleton
class AuthRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val client: SupabaseClient? = CloudClient.client
    private val prefs = context.getSharedPreferences("mv_cloud", Context.MODE_PRIVATE)

    val isConfigured: Boolean get() = client != null

    /** Raw session status flow; empty-configured installs get a constant flow. */
    val sessionStatus: Flow<SessionStatus> =
        client?.auth?.sessionStatus ?: flowOf(SessionStatus.NotAuthenticated(false))

    suspend fun signIn(email: String, password: String) {
        val c = client ?: return
        c.auth.signInWith(Email) {
            this.email = email
            this.password = password
        }
        registerDevice()
    }

    /** Returns true when a session exists right away (email confirmation off). */
    suspend fun signUp(email: String, password: String): Boolean {
        val c = client ?: return false
        c.auth.signUpWith(Email) {
            this.email = email
            this.password = password
        }
        val signedIn = c.auth.currentSessionOrNull() != null
        if (signedIn) registerDevice()
        return signedIn
    }

    suspend fun signOut() {
        val c = client ?: return
        try {
            c.auth.signOut()
        } catch (e: Exception) {
            Timber.e(e, "sign-out failed")
        }
    }

    /**
     * Registers this install in the devices table (or refreshes last_seen_at).
     * The device id is persisted so statistics can attribute play events.
     * One registration at a time: startup and sign-in can both ask at once,
     * which used to add the same phone two or three times.
     */
    suspend fun registerDevice() = registerLock.withLock {
        val c = client ?: return@withLock
        val userId = c.auth.currentUserOrNull()?.id ?: return@withLock
        val name = deviceLabel()
        try {
            val storedId = prefs.getString(KEY_DEVICE_ID, null)
            if (storedId != null) {
                val updated = c.from("devices").update({
                    set("last_seen_at", Instant.now().toString())
                    set("name", name)
                }) {
                    select()
                    filter { eq("id", storedId) }
                }.decodeSingleOrNull<DeviceRow>()
                if (updated != null) return@withLock
                // stored id no longer exists — fall through and re-register
            }
            // A reinstall loses the stored id; the same phone comes back under
            // the same name and takes its old row (core supabase/devices.ts).
            val same = c.from("devices").select {
                filter {
                    eq("user_id", userId)
                    eq("name", name)
                    eq("platform", "android")
                }
                order("last_seen_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(1)
            }.decodeList<DeviceRow>().firstOrNull()
            if (same != null) {
                c.from("devices").update({ set("last_seen_at", Instant.now().toString()) }) {
                    filter { eq("id", same.id) }
                }
                prefs.edit { putString(KEY_DEVICE_ID, same.id) }
                return@withLock
            }
            val created = c.from("devices").insert(
                NewDevice(userId = userId, name = name, platform = "android")
            ) { select() }.decodeSingle<DeviceRow>()
            prefs.edit { putString(KEY_DEVICE_ID, created.id) }
        } catch (e: Exception) {
            Timber.e(e, "device registration failed")
        }
    }

    /** "Nothing A001"; an emulator says so instead of naming its build. */
    private fun deviceLabel(): String {
        val model = android.os.Build.MODEL
        val emulator = android.os.Build.FINGERPRINT.startsWith("generic") ||
            android.os.Build.FINGERPRINT.contains("emulator") ||
            model.startsWith("sdk_gphone") || model.contains("Emulator")
        return if (emulator) "Android emulator" else "${android.os.Build.MANUFACTURER} $model"
    }

    fun deviceId(): String? = prefs.getString(KEY_DEVICE_ID, null)

    /** The account's device names by id, for "Play time by device"; empty when signed out or offline. */
    suspend fun deviceNames(): Map<String, String> {
        val c = client ?: return emptyMap()
        if (c.auth.currentUserOrNull() == null) return emptyMap()
        return try {
            // id and name only: the table is small and holds nothing else needed here.
            c.from("devices").select(io.github.jan.supabase.postgrest.query.Columns.list("id", "name"))
                .decodeList<DeviceName>()
                .associate { it.id to it.name }
        } catch (e: Exception) {
            Timber.w(e, "loading device names failed")
            emptyMap()
        }
    }

    private val registerLock = Mutex()

    private companion object {
        const val KEY_DEVICE_ID = "device_id"
    }
}
