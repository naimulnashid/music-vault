package com.musicvault.data.vault

import com.musicvault.data.db.SyncDao
import com.musicvault.data.sync.RemoteTrackIndex
import com.musicvault.data.sync.SyncBus
import com.musicvault.data.sync.SyncJson
import com.musicvault.data.sync.SyncOp
import com.musicvault.data.sync.SyncOpPayload
import com.musicvault.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pictures kept as settings rows (core artistPhotos.ts and collectionCovers.ts,
 * supabase/migrations/0008 and 0009): scope [scope], key = what the picture
 * belongs to, value = the cover key of the picture or null once removed. They
 * sync like any setting, so this reads the settings shadow and queues
 * `setting.set` ops.
 */
abstract class SettingCovers(
    private val scope: String,
    syncDao: SyncDao,
    private val artwork: VaultArtwork,
    private val vaultApi: VaultApi,
    index: RemoteTrackIndex,
    appScope: CoroutineScope,
) {
    /** Edits this device queued, laid over the synced rows until a pull brings them back. */
    private val local = MutableStateFlow<Map<String, String?>>(emptyMap())

    /** Owner (artist name, collection key) → cover key. */
    val keys: Flow<Map<String, String>> = combine(syncDao.observeShadow(SHADOW), local) { rows, local ->
        val out = HashMap<String, String>()
        for (row in rows) {
            val obj = runCatching { SyncJson.parseToJsonElement(row.payload).jsonObject }.getOrNull() ?: continue
            if (obj.string("scope") != scope) continue
            val artist = obj.string("key") ?: continue
            put(out, artist, obj["value"])
        }
        for ((artist, key) in local) put(out, artist, key?.let(::JsonPrimitive) ?: JsonNull)
        out
    }

    /** Owner → cached picture file; pictures not cached yet download in the background. */
    val paths: Flow<Map<String, String>> = combine(keys, index.art) { keys, art ->
        keys.mapNotNull { (artist, key) -> art[key]?.let { artist to it } }.toMap()
    }

    val signedIn: Boolean get() = vaultApi.userId() != null

    init {
        appScope.launch {
            // Queued edits survive a restart: read them back once from the outbox.
            runCatching {
                val pending = syncDao.outboxAll().mapNotNull { row ->
                    (SyncJson.decodeFromString(SyncOp.serializer(), row.payload).payload as? SyncOpPayload.SettingSet)
                        ?.takeIf { it.scope == scope }
                }
                local.update { current ->
                    pending.associate { it.key to coverKey(it.value) } + current
                }
            }.onFailure { Timber.w(it, "reading queued $scope edits failed") }
        }
        appScope.launch { keys.collect { artwork.cache(it.values) } }
    }

    /** Uploads [cover] as [owner]'s picture, or removes the picture when null. */
    suspend fun set(owner: String, cover: PreparedCover?) {
        val key = cover?.let { artwork.upload(it) }
        local.update { it + (owner to key) }
        SyncBus.enqueue(SyncOpPayload.SettingSet(scope, owner, key?.let(::JsonPrimitive) ?: JsonNull, SyncBus.nowIso()))
    }

    private fun put(out: MutableMap<String, String>, artist: String, value: JsonElement?) {
        val key = coverKey(value)
        if (key != null) out[artist] = key else out.remove(artist)
    }

    private fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.contentOrNull

    companion object {
        private const val SHADOW = "settings"
        private val COVER_KEY = Regex("^users/[0-9a-f-]{36}/art/[0-9a-f]{64}\\.jpg$")

        /** The cover key a setting value holds, or null for a removed or malformed picture. */
        fun coverKey(value: JsonElement?): String? =
            (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { COVER_KEY.matches(it) }
    }
}

/** Artist photos: key = the artist's name. */
@Singleton
class ArtistPhotos @Inject constructor(
    syncDao: SyncDao,
    artwork: VaultArtwork,
    vaultApi: VaultApi,
    index: RemoteTrackIndex,
    @ApplicationScope scope: CoroutineScope,
) : SettingCovers(SCOPE, syncDao, artwork, vaultApi, index, scope) {
    companion object {
        const val SCOPE = "artist_photo"
    }
}

/**
 * Covers picked for playlists and smart groups: key = "<kind>:<id>", such as
 * "playlist:<uuid>" or "country:Bangladesh" (core collectionKey).
 */
@Singleton
class CollectionCovers @Inject constructor(
    syncDao: SyncDao,
    artwork: VaultArtwork,
    vaultApi: VaultApi,
    index: RemoteTrackIndex,
    @ApplicationScope scope: CoroutineScope,
) : SettingCovers(SCOPE, syncDao, artwork, vaultApi, index, scope) {
    companion object {
        const val SCOPE = "collection_cover"

        fun key(kind: String, id: String) = "$kind:$id"
    }
}
