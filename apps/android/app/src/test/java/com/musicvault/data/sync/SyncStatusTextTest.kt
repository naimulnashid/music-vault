package com.musicvault.data.sync

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

class SyncStatusTextTest {
    private val zone = ZoneId.of("Asia/Dhaka")
    private val now = ZonedDateTime.of(2026, 10, 21, 15, 0, 0, 0, zone)
    private fun text(status: SyncStatus) = describeSyncStatus(status, now, Locale.UK)

    @Test
    fun `a server error says edits are kept and when sync last worked`() {
        val t = text(SyncStatus(SyncPhase.ERROR, pendingOps = 3, lastSyncAt = "2026-10-21T04:42:00Z", lastError = "boom"))
        assertThat(t.label).isEqualTo("Sync issue, will retry")
        assertThat(t.details).containsExactly("3 changes kept on this device", "Last synced 10:42").inOrder()
        assertThat(t.needsSignIn).isFalse()
    }

    @Test
    fun `an expired session asks for sign-in instead of promising a retry`() {
        val t = text(SyncStatus(SyncPhase.AUTH, pendingOps = 1))
        assertThat(t).isEqualTo(SyncStatusText("Sign in again to sync", listOf("1 change kept on this device"), true))
    }

    @Test
    fun `offline with nothing waiting shows only how stale this device is`() {
        val t = text(SyncStatus(SyncPhase.OFFLINE, lastSyncAt = "2026-10-19T03:00:00Z"))
        assertThat(t.label).isEqualTo("Offline")
        assertThat(t.details).containsExactly("Last synced 19 Oct")
    }

    @Test
    fun `offline with nothing known says what happens to edits`() {
        assertThat(text(SyncStatus(SyncPhase.OFFLINE)).details).containsExactly("Edits sync when you're back online")
    }

    @Test
    fun `an error before any sync has succeeded has no detail`() {
        assertThat(text(SyncStatus(SyncPhase.ERROR, lastError = "boom")).details).isEmpty()
    }

    @Test
    fun `healthy states keep one line`() {
        assertThat(text(SyncStatus())).isEqualTo(SyncStatusText("Everything synced", emptyList(), false))
        assertThat(text(SyncStatus(pendingOps = 2)).label).isEqualTo("2 changes queued")
        assertThat(text(SyncStatus(SyncPhase.SYNCING, pendingOps = 2)).details).isEmpty()
    }
}
