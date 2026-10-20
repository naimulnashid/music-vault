package com.musicvault.data.vault

import com.musicvault.BuildConfig
import com.musicvault.data.cloud.CloudClient
import io.github.rctcwyvrn.blake3.Blake3
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** A refusal or failure reported by the vault (HTTP status + machine code). */
class VaultException(val status: Int, val code: String, message: String) : Exception(message)

/** The vault couldn't be reached — retry when back online. */
class VaultNetworkException(message: String, cause: Throwable? = null) : Exception(message, cause)

data class SignedPut(val key: String, val url: String)

/**
 * Client for the `vault` Edge Function — the Kotlin counterpart of
 * packages/core/src/vault.ts (docs/drive-to-r2-migration.md §2.3). The
 * function hands out short-lived pre-signed R2 URLs; bytes go straight
 * between the phone and R2 over OkHttp.
 */
@Singleton
class VaultApi @Inject constructor() {

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    private val endpoint get() = "${BuildConfig.SUPABASE_URL}/functions/v1/vault"

    val isConfigured: Boolean get() = CloudClient.client != null

    /** The signed-in user's id, or null. */
    fun userId(): String? = CloudClient.client?.auth?.currentUserOrNull()?.id

    private fun token(): String =
        CloudClient.client?.auth?.currentAccessTokenOrNull()
            ?: throw VaultException(401, "unauthorized", "Sign in to use your vault")

    private suspend fun invoke(body: JsonObject): JsonObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer ${token()}")
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .post(body.toString().toRequestBody(JSON))
            .build()
        val response = try {
            http.newCall(request).execute()
        } catch (e: IOException) {
            throw VaultNetworkException(e.message ?: "network error", e)
        }
        response.use { res ->
            val text = res.body?.string().orEmpty()
            val parsed = runCatching { VaultJson.parseToJsonElement(text).jsonObject }.getOrNull()
            if (!res.isSuccessful) {
                throw VaultException(
                    res.code,
                    parsed?.get("error")?.jsonPrimitive?.content ?: "http_error",
                    parsed?.get("message")?.jsonPrimitive?.content ?: "vault returned ${res.code}",
                )
            }
            parsed ?: throw VaultException(res.code, "bad_reply", "vault returned no JSON")
        }
    }

    // ---- signed URLs ------------------------------------------------------------

    private data class Signed(val url: String, val expiresAtMs: Long)

    private val signedCache = HashMap<String, Signed>()

    /** Pre-signed GET URLs for the readable subset of [keys], reused until shortly before expiry. */
    suspend fun signGet(keys: List<String>): Map<String, String> {
        val now = System.currentTimeMillis()
        val out = HashMap<String, String>()
        val missing = mutableListOf<String>()
        synchronized(signedCache) {
            for (key in keys.distinct()) {
                val hit = signedCache[key]
                if (hit != null && hit.expiresAtMs - MARGIN_MS > now) out[key] = hit.url else missing += key
            }
        }
        for (chunk in missing.chunked(MAX_KEYS_PER_SIGN_GET)) {
            val reply = invoke(
                buildJsonObject {
                    put("action", "sign-get")
                    putJsonArray("keys") { chunk.forEach { add(JsonPrimitive(it)) } }
                },
            )
            val expiresAt = now + (reply["expiresIn"]?.jsonPrimitive?.int ?: 0) * 1000L
            val urls = reply["urls"]?.jsonObject ?: JsonObject(emptyMap())
            synchronized(signedCache) {
                for ((key, value) in urls) {
                    val url = value.jsonPrimitive.content
                    signedCache[key] = Signed(url, expiresAt)
                    out[key] = url
                }
            }
        }
        return out
    }

    suspend fun signGetOne(key: String): String? = signGet(listOf(key))[key]

    /** Sign-out: signed links belong to the account that asked for them. */
    fun forgetSignedUrls() = synchronized(signedCache) { signedCache.clear() }

    suspend fun signPutAudio(trackId: String, ext: String): SignedPut = invoke(
        buildJsonObject {
            put("action", "sign-put")
            put("kind", "audio")
            put("trackId", trackId)
            put("ext", ext)
        },
    ).let { SignedPut(it.getValue("key").jsonPrimitive.content, it.getValue("url").jsonPrimitive.content) }

    suspend fun signPutArt(sha256: String, variant: String, size: Long): SignedPut = invoke(
        buildJsonObject {
            put("action", "sign-put")
            put("kind", "art")
            put("sha256", sha256)
            put("variant", variant)
            put("size", size)
        },
    ).let { SignedPut(it.getValue("key").jsonPrimitive.content, it.getValue("url").jsonPrimitive.content) }

    /** Confirms an uploaded audio object and records it on the track; returns the storage key. */
    suspend fun commit(trackId: String, ext: String): String = invoke(
        buildJsonObject {
            put("action", "commit")
            put("trackId", trackId)
            put("ext", ext)
        },
    ).getValue("storageKey").jsonPrimitive.content

    /** "Delete from vault": tombstones the track and removes its objects. */
    suspend fun remove(trackId: String) {
        invoke(
            buildJsonObject {
                put("action", "delete")
                put("trackId", trackId)
            },
        )
    }

    /** The existing row an upload of this file should attach to, or null for a new song. */
    suspend fun resolveUploadTarget(contentHash: String): String? = withContext(Dispatchers.IO) {
        val client = CloudClient.client ?: throw VaultException(401, "unauthorized", "Sign in to use your vault")
        val result = try {
            client.postgrest.rpc(
                "resolve_upload_target",
                buildJsonObject {
                    put("p_content_hash", contentHash)
                    put("p_md5", JsonNull) // old Drive-row linking; the parameter goes at M7
                },
            )
        } catch (e: IOException) {
            throw VaultNetworkException(e.message ?: "network error", e)
        }
        val element = runCatching { VaultJson.parseToJsonElement(result.data) }.getOrNull()
        (element as? JsonPrimitive)?.takeIf { it.isString }?.content
    }

    // ---- byte transfers ---------------------------------------------------------

    /** PUTs a file to a pre-signed URL, reporting (sent, total) as it goes. */
    suspend fun putFile(url: String, file: File, contentType: String, onProgress: (Long, Long) -> Unit = { _, _ -> }) =
        withContext(Dispatchers.IO) {
            val total = file.length()
            val body = object : RequestBody() {
                override fun contentType() = contentType.toMediaType()
                override fun contentLength() = total
                override fun writeTo(sink: BufferedSink) {
                    file.inputStream().use { input ->
                        val buffer = ByteArray(256 * 1024)
                        var sent = 0L
                        var lastReport = 0L
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            sink.write(buffer, 0, n)
                            sent += n
                            val now = System.currentTimeMillis()
                            if (now - lastReport > 250 || sent == total) {
                                lastReport = now
                                onProgress(sent, total)
                            }
                        }
                    }
                }
            }
            val request = Request.Builder().url(url).put(body).build()
            val response = try {
                http.newCall(request).execute()
            } catch (e: IOException) {
                throw VaultNetworkException("Upload failed: ${e.message}", e)
            }
            response.use { res ->
                if (!res.isSuccessful) {
                    throw VaultException(res.code, "upload_rejected", "Upload rejected (${res.code})")
                }
            }
        }

    /** GETs a small object (a cover) into memory. */
    suspend fun download(url: String): ByteArray = withContext(Dispatchers.IO) {
        val response = try {
            http.newCall(Request.Builder().url(url).build()).execute()
        } catch (e: IOException) {
            throw VaultNetworkException(e.message ?: "network error", e)
        }
        response.use { res ->
            if (!res.isSuccessful) throw VaultException(res.code, "download_rejected", "Download rejected (${res.code})")
            res.body?.bytes() ?: ByteArray(0)
        }
    }

    /**
     * Streams a GET into [dest], reporting (read, total) as it goes, and returns
     * the BLAKE3 of the bytes written — the caller checks it against the hash
     * the track is named by.
     */
    suspend fun downloadTo(url: String, dest: File, onProgress: suspend (Long, Long) -> Unit = { _, _ -> }): String =
        withContext(Dispatchers.IO) {
            val response = try {
                http.newCall(Request.Builder().url(url).build()).execute()
            } catch (e: IOException) {
                throw VaultNetworkException(e.message ?: "network error", e)
            }
            response.use { res ->
                if (!res.isSuccessful) throw VaultException(res.code, "download_rejected", "Download rejected (${res.code})")
                val body = res.body ?: throw VaultException(res.code, "download_rejected", "Empty download")
                val total = body.contentLength()
                val hasher = Blake3.newInstance()
                dest.parentFile?.mkdirs()
                try {
                    body.byteStream().use { input ->
                        dest.outputStream().use { output ->
                            val buffer = ByteArray(256 * 1024)
                            var read = 0L
                            var lastReport = 0L
                            while (true) {
                                val n = input.read(buffer)
                                if (n < 0) break
                                output.write(buffer, 0, n)
                                hasher.update(buffer.copyOfRange(0, n))
                                read += n
                                val now = System.currentTimeMillis()
                                if (now - lastReport > 300) {
                                    lastReport = now
                                    onProgress(read, total)
                                }
                            }
                            onProgress(read, if (total > 0) total else read)
                        }
                    }
                } catch (e: IOException) {
                    dest.delete()
                    throw VaultNetworkException(e.message ?: "network error", e)
                }
                hasher.hexdigest()
            }
        }

    companion object {
        private val JSON = "application/json".toMediaType()
        private const val MAX_KEYS_PER_SIGN_GET = 200
        private const val MARGIN_MS = 120_000L
        val VaultJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

        /** BLAKE3 of a file's bytes — a vault track's identity. */
        fun blake3Of(file: File): String {
            val hasher = Blake3.newInstance()
            file.inputStream().use { input ->
                val buffer = ByteArray(256 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    hasher.update(buffer.copyOfRange(0, n))
                }
            }
            return hasher.hexdigest()
        }

        /** MIME type sent with an audio upload. */
        fun audioMime(ext: String): String = when (ext) {
            "mp3" -> "audio/mpeg"
            "flac" -> "audio/flac"
            "wav" -> "audio/wav"
            "ogg", "oga", "opus" -> "audio/ogg"
            "m4a", "mp4", "alac" -> "audio/mp4"
            "aac" -> "audio/aac"
            "aiff", "aif" -> "audio/aiff"
            else -> "application/octet-stream"
        }

        /** The thumbnail key belonging to a full-size cover key. */
        fun thumbKeyOf(artworkKey: String): String = artworkKey.removeSuffix(".jpg") + ".thumb.jpg"
    }
}
