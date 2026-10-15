package com.musicvault.playback

import android.media.audiofx.DynamicsProcessing
import com.musicvault.domain.model.Eq
import timber.log.Timber
import kotlin.math.sqrt

/**
 * 10-band EQ replacement for the web app's BiquadFilter chain (audioEngine.ts).
 *
 * DynamicsProcessing's pre-EQ stage is band-split by cutoff frequencies rather
 * than peaking filters, so each web center frequency becomes a band whose upper
 * cutoff is the geometric mean between it and the next center — audibly
 * equivalent for a graphic EQ.
 */
class EqController {

    private var effect: DynamicsProcessing? = null
    private var sessionId: Int = -1
    private var lastBands: List<Float> = Eq.PRESETS.getValue("Flat")

    private val cutoffs: List<Float> = Eq.FREQS.mapIndexed { i, freq ->
        if (i == Eq.FREQS.size - 1) 20_000f
        else sqrt(freq.toFloat() * Eq.FREQS[i + 1].toFloat())
    }

    fun attach(audioSessionId: Int) {
        if (sessionId == audioSessionId && effect != null) return
        release()
        sessionId = audioSessionId
        try {
            val config = DynamicsProcessing.Config.Builder(
                DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                /* channelCount = */ 2,
                /* preEqInUse = */ true,
                /* preEqBandCount = */ Eq.FREQS.size,
                /* mbcInUse = */ false,
                /* mbcBandCount = */ 0,
                /* postEqInUse = */ false,
                /* postEqBandCount = */ 0,
                /* limiterInUse = */ false,
            ).build()
            effect = DynamicsProcessing(0, audioSessionId, config).also { dp ->
                dp.enabled = true
            }
            setBands(lastBands)
            Timber.i("EQ attached to audio session %d", audioSessionId)
        } catch (e: Exception) {
            // Some devices refuse the effect (e.g. offload paths); playback keeps working without EQ.
            Timber.e(e, "Failed to create DynamicsProcessing EQ")
            effect = null
        }
    }

    fun setBands(bands: List<Float>) {
        lastBands = bands
        val dp = effect ?: return
        try {
            bands.forEachIndexed { i, gain ->
                if (i < cutoffs.size) {
                    val band = DynamicsProcessing.EqBand(true, cutoffs[i], gain.coerceIn(-Eq.MAX_GAIN_DB, Eq.MAX_GAIN_DB))
                    dp.setPreEqBandAllChannelsTo(i, band)
                }
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to apply EQ bands")
        }
    }

    fun release() {
        try {
            effect?.release()
        } catch (e: Exception) {
            Timber.w(e, "Failed to release EQ")
        }
        effect = null
        sessionId = -1
    }
}
