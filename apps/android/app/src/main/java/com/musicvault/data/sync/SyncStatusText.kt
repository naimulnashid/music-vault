package com.musicvault.data.sync

import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The account menu's sync row: [label] says what sync is doing or why it stopped. */
data class SyncStatusText(
    val label: String,
    /** One line each: what that means for the user's edits, and when sync last worked. Empty when the label says it all. */
    val details: List<String>,
    /** The session can't be renewed: the fix is signing in, not waiting. */
    val needsSignIn: Boolean,
)

private fun changes(n: Int) = "$n change${if (n == 1) "" else "s"}"

/**
 * When sync is stuck, the detail lines answer what a user needs to know: are my
 * edits safe (kept on this device until they go up), and how stale is this device.
 * Mirrors describeSyncStatus in packages/core/src/sync/statusText.ts.
 */
fun describeSyncStatus(
    status: SyncStatus,
    now: ZonedDateTime = ZonedDateTime.now(),
    locale: Locale = Locale.getDefault(),
): SyncStatusText {
    fun stuck(): List<String> = listOfNotNull(
        if (status.pendingOps > 0) "${changes(status.pendingOps)} kept on this device" else null,
        lastSynced(status.lastSyncAt, now, locale),
    )
    return when (status.phase) {
        SyncPhase.SYNCING -> SyncStatusText("Syncing…", emptyList(), false)
        SyncPhase.OFFLINE -> SyncStatusText("Offline", stuck().ifEmpty { listOf("Edits sync when you're back online") }, false)
        SyncPhase.AUTH -> SyncStatusText("Sign in again to sync", stuck(), true)
        SyncPhase.ERROR -> SyncStatusText("Sync issue, will retry", stuck(), false)
        SyncPhase.IDLE ->
            if (status.pendingOps > 0) SyncStatusText("${changes(status.pendingOps)} queued", emptyList(), false)
            else SyncStatusText("Everything synced", emptyList(), false)
    }
}

/** "Last synced 10:42" today, "Last synced 20 Oct" before; null if it never has. */
private fun lastSynced(at: String?, now: ZonedDateTime, locale: Locale): String? {
    val time = at?.let { runCatching { Instant.parse(it) }.getOrNull() }?.atZone(now.zone) ?: return null
    val format =
        if (time.toLocalDate() == now.toLocalDate()) DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
        else DateTimeFormatter.ofPattern("d MMM")
    return "Last synced ${time.format(format.withLocale(locale))}"
}
