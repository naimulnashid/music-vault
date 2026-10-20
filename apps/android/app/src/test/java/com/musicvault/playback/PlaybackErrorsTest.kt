package com.musicvault.playback

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.net.UnknownHostException
import org.junit.Test

class PlaybackErrorsTest {

    @Test
    fun `offline failures name the song and say it isn't available offline`() {
        assertThat(PlaybackErrors.message("Darkside", offline = true)).isEqualTo("Darkside: Not available offline")
    }

    @Test
    fun `other failures don't blame the connection`() {
        assertThat(PlaybackErrors.message("Darkside", offline = false)).isEqualTo("Darkside: Couldn't play this song")
    }

    @Test
    fun `a DNS failure anywhere in the cause chain counts as a network failure`() {
        val error = RuntimeException("source error", IOException("couldn't sign", UnknownHostException("no host")))
        assertThat(PlaybackErrors.isNetworkFailure(error)).isTrue()
    }

    @Test
    fun `a decoder or refusal error is not a network failure`() {
        assertThat(PlaybackErrors.isNetworkFailure(IOException("The vault refused this track"))).isFalse()
    }
}
