package com.musicvault.playback.formats

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorsFactory

/**
 * Media3's extractors plus APE and WavPack. Ours sniff first: each only checks
 * a magic number at the start, and that way no other extractor's looser sniff
 * (MP3 sync words, say) gets a chance at their compressed data. A vault URI's
 * path has no file extension, so sniffing is what picks the extractor.
 */
@OptIn(UnstableApi::class)
class VaultExtractorsFactory : ExtractorsFactory {
    private val default = DefaultExtractorsFactory()

    override fun createExtractors(): Array<Extractor> =
        arrayOf<Extractor>(ApeExtractor(), WavPackExtractor()) + default.createExtractors()

    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>): Array<Extractor> =
        arrayOf<Extractor>(ApeExtractor(), WavPackExtractor()) + default.createExtractors(uri, responseHeaders)
}
