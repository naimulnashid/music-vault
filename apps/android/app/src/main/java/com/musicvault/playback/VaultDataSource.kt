package com.musicvault.playback

import android.net.Uri
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import com.musicvault.data.vault.AudioCache
import com.musicvault.data.vault.VaultApi
import com.musicvault.data.vault.VaultMerge
import kotlinx.coroutines.runBlocking
import java.io.IOException
import okhttp3.OkHttpClient
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Play resolution for `vault://<hash>?key=<storage key>` media URIs: the
 * pinned download if there is one, else a pre-signed R2 URL streamed through
 * the auto-cache (Media3 CacheDataSource keyed by the content hash, so the
 * bytes are fetched once and survive re-signed URLs). Other URIs (file://)
 * pass straight through to the default source.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class VaultDataSource(
    private val localSource: DataSource,
    private val cachedHttpSource: DataSource,
    /** Straight from the vault, for when the auto-cache is off or auto-download keeps everything. */
    private val plainHttpSource: DataSource,
    private val cache: AudioCache,
    private val vaultApi: VaultApi,
) : DataSource {

    private var active: DataSource? = null

    override fun open(dataSpec: DataSpec): Long {
        val uri = dataSpec.uri
        if (uri.scheme != VaultMerge.VAULT_SCHEME) {
            active = localSource
            return localSource.open(dataSpec)
        }
        val hash = uri.host.orEmpty()
        val key = uri.getQueryParameter("key") ?: throw IOException("vault track without a storage key")
        cache.pinnedVaultFile(hash)?.let { file ->
            active = localSource
            return localSource.open(dataSpec.buildUpon().setUri(Uri.fromFile(file)).build())
        }
        // Signing is I/O; ExoPlayer opens sources on its loading thread, not main.
        val url = runBlocking { vaultApi.signGetOne(key) }
            ?: throw IOException("The vault refused this track (signed out, or it was deleted)")
        val source = if (cache.cacheEnabled) cachedHttpSource else plainHttpSource
        active = source
        return source.open(
            dataSpec.buildUpon()
                .setUri(Uri.parse(url))
                .setKey("vault:$hash") // stable across re-signed URLs
                .build(),
        )
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        active?.read(buffer, offset, length) ?: -1

    override fun addTransferListener(transferListener: TransferListener) {
        localSource.addTransferListener(transferListener)
        cachedHttpSource.addTransferListener(transferListener)
        plainHttpSource.addTransferListener(transferListener)
    }

    override fun getUri(): Uri? = active?.uri

    override fun close() {
        active?.close()
        active = null
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Singleton
class VaultDataSourceFactory @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val cache: AudioCache,
    private val vaultApi: VaultApi,
) : DataSource.Factory {

    private val http = OkHttpClient()

    override fun createDataSource(): DataSource {
        val cachedHttp = CacheDataSource.Factory()
            .setCache(cache.simpleCache)
            .setUpstreamDataSourceFactory(OkHttpDataSource.Factory(http))
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
            .createDataSource()
        return VaultDataSource(
            localSource = DefaultDataSource.Factory(context).createDataSource(),
            cachedHttpSource = cachedHttp,
            plainHttpSource = OkHttpDataSource.Factory(http).createDataSource(),
            cache = cache,
            vaultApi = vaultApi,
        )
    }
}
