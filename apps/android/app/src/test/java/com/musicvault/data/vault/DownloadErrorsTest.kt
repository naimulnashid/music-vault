package com.musicvault.data.vault

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.net.UnknownHostException
import org.junit.Test

class DownloadErrorsTest {
    @Test
    fun `the vault's own message is shown as it is`() {
        assertThat(DownloadErrors.reason(VaultException(404, "not_found", "This track is no longer in your vault")))
            .isEqualTo("This track is no longer in your vault")
    }

    @Test
    fun `network failures say the vault couldn't be reached`() {
        assertThat(DownloadErrors.reason(VaultNetworkException("timeout"))).isEqualTo("Couldn't reach the vault")
        assertThat(DownloadErrors.reason(IOException("stream", UnknownHostException("no host"))))
            .isEqualTo("Couldn't reach the vault")
    }

    @Test
    fun `a full disk is named as such`() {
        assertThat(DownloadErrors.reason(IOException("write failed: ENOSPC (No space left on device)")))
            .isEqualTo("Not enough storage on this device")
    }

    @Test
    fun `anything else gets a plain message`() {
        assertThat(DownloadErrors.reason(IllegalStateException("boom"))).isEqualTo("Download failed")
    }
}
