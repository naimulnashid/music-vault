package com.musicvault.data.sync

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.UUID

/**
 * The MusicVault sync engine — 1:1 Kotlin port of
 * packages/core/src/sync/engine.ts (docs/sync-protocol.md is the spec;
 * conflict semantics are locked by SyncEngineTest, which mirrors
 * packages/core/tests/syncEngine.test.ts).
 *
 * One instance per signed-in session. All server I/O goes through the
 * transport, all persistence through the storage — both injectable, so the
 * whole conflict surface is testable without a network.
 *
 * Cycle serialization differs mechanically from the TS engine (a [Mutex]
 * instead of promise chaining) but preserves the invariant that cycles never
 * overlap; redundant queued cycles are cheap no-op pulls.
 */
class SyncEngine(
    private val transport: SyncTransport,
    private val storage: SyncStorage,
    private val options: Options,
) {
    class Options(
        /** This install's devices.id row (stamped on ops and play events). */
        val deviceId: String?,
        /** Scope for auto-sync kicks and the Realtime debounce timer. */
        val scope: CoroutineScope,
        /** Clock/uuid injection points for deterministic tests. */
        val now: () -> String = { Instant.now().toString() },
        val uuid: () -> String = { UUID.randomUUID().toString() },
        /** When false, enqueue does not kick a sync cycle (tests drive syncNow). */
        val autoSync: Boolean = true,
        /** Remote state applied by a pull (or lost LWW conflicts at flush). */
        val onChanges: (RemoteChanges) -> Unit = {},
        val onStatus: (SyncStatus) -> Unit = {},
        /** Diagnostic trail (cycle outcomes, op failures, lost conflicts). */
        val onBreadcrumb: (SyncBreadcrumb) -> Unit = {},
    )

    /** Track identity maps rebuilt from the shadow at init and kept warm. */
    private val trackById = HashMap<String, TrackIdentity>()
    private val trackByHash = HashMap<String, String>()
    /** Merge tombstone id → the row that absorbed it (followed when resolving). */
    private val mergedInto = HashMap<String, String>()

    private var status = SyncStatus()
    private val cycleMutex = Mutex()
    private var realtimeUnsub: (() -> Unit)? = null
    private var realtimeJob: Job? = null
    private var disposed = false
    /** Set while there is no usable session; cycles are skipped so nothing goes out with only the anon key. */
    @Volatile private var paused = false

    /** Loads the track shadow into the identity maps. Call once before use. */
    suspend fun init() {
        for ((_, payload) in storage.shadowAll("tracks").map { it.id to it.payload }) {
            indexTrack(SyncJson.decodeFromString(TrackRow.serializer(), payload))
        }
        status = status.copy(pendingOps = storage.outboxAll().size)
        emitStatus()
    }

    fun getStatus(): SyncStatus = status

    /** Last N diagnostic breadcrumbs, oldest first (ring buffer, max 200). */
    fun getBreadcrumbs(): List<SyncBreadcrumb> = synchronized(breadcrumbs) { breadcrumbs.toList() }

    private val breadcrumbs = ArrayDeque<SyncBreadcrumb>()

    private fun crumb(event: String, detail: Map<String, Any?> = emptyMap()) {
        val crumb = SyncBreadcrumb(at = options.now(), event = event, detail = detail)
        synchronized(breadcrumbs) {
            breadcrumbs.addLast(crumb)
            if (breadcrumbs.size > 200) breadcrumbs.removeFirst()
        }
        options.onBreadcrumb(crumb)
    }

    /** Starts the Realtime subscription (pull-sooner hints). */
    fun start() {
        if (realtimeUnsub == null) {
            realtimeUnsub = transport.subscribe { schedulePull() }
        }
    }

    fun stop() {
        disposed = true
        realtimeJob?.cancel()
        realtimeUnsub?.invoke()
        realtimeUnsub = null
    }

    /** Holds every cycle (flush and pull); enqueued ops just wait in the outbox. */
    fun pause() {
        paused = true
    }

    /** Lifts [pause] (or an auth failure's pause). The caller kicks the next cycle. */
    fun resume() {
        paused = false
    }

    /** True while paused or after the session was rejected: a fresh session should resume and sync. */
    val needsSession: Boolean get() = paused || status.phase == SyncPhase.AUTH

    /** Queues a mutation and kicks a sync cycle. Refs without identity are dropped. */
    suspend fun enqueue(payload: SyncOpPayload) {
        if (!payload.isSyncable()) {
            crumb("enqueue.dropped", mapOf("kind" to payload.kind()))
            return
        }
        val op = SyncOp(
            id = options.uuid(),
            deviceId = options.deviceId,
            createdAt = options.now(),
            payload = payload,
        )
        storage.outboxPut(op)
        status = status.copy(pendingOps = status.pendingOps + 1)
        emitStatus()
        if (options.autoSync) options.scope.launch { syncNow() }
    }

    /** Runs flush + pull. Cycles are serialized — they never overlap. */
    suspend fun syncNow(fullPull: Boolean = false) {
        if (disposed || paused) return
        cycleMutex.withLock { if (!paused) runCycle(fullPull) }
    }

    /** Connectivity restored — retry whatever is queued. */
    fun notifyOnline() {
        options.scope.launch { syncNow() }
    }

    private fun schedulePull() {
        if (disposed) return
        if (realtimeJob?.isActive != true) crumb("realtime.hint")
        realtimeJob?.cancel()
        realtimeJob = options.scope.launch {
            delay(REALTIME_DEBOUNCE_MS)
            syncNow()
        }
    }

    private suspend fun runCycle(fullPull: Boolean) {
        setPhase(SyncPhase.SYNCING)
        crumb("cycle.start", mapOf("full" to fullPull, "pendingOps" to status.pendingOps))
        val startedAt = System.currentTimeMillis()
        val changes = RemoteChanges()
        try {
            try {
                exchange(fullPull, changes)
            } catch (err: SyncAuthException) {
                // Usually a token that expired while the process was frozen (an
                // emulator snapshot, a long doze) without the auth layer noticing.
                crumb("auth.rejected", mapOf("error" to err.message))
                try {
                    transport.refreshAuth()
                } catch (refreshErr: SyncNetworkException) {
                    throw refreshErr
                } catch (refreshErr: Exception) {
                    throw SyncAuthException(refreshErr.message ?: refreshErr.toString(), refreshErr)
                }
                crumb("auth.refreshed")
                exchange(fullPull, changes) // once: a second rejection lands below
            }
        } catch (err: SyncAuthException) {
            // Retrying would only repeat the 401; wait for a new session instead.
            paused = true
            status = status.copy(
                phase = SyncPhase.AUTH,
                pendingOps = storage.outboxAll().size,
                lastError = err.message ?: err.toString(),
            )
        } catch (err: Exception) {
            val offline = err is SyncNetworkException
            status = status.copy(
                phase = if (offline) SyncPhase.OFFLINE else SyncPhase.ERROR,
                pendingOps = storage.outboxAll().size,
                lastError = err.message ?: err.toString(),
            )
        }
        if (changes.hasAny()) {
            crumb(
                "pull.applied",
                mapOf(
                    "tracksChanged" to changes.tracksChanged,
                    "favorites" to changes.favorites.size,
                    "ratings" to changes.ratings.size,
                    "playlists" to changes.playlists.size,
                    "playlistItems" to changes.playlistItems.size,
                    "settings" to changes.settings.size,
                    "queue" to (changes.queue != null),
                    "playEvents" to changes.playEventsAdded,
                ),
            )
        }
        crumb(
            "cycle.end",
            buildMap {
                put("phase", status.phase.name.lowercase())
                put("pendingOps", status.pendingOps)
                put("ms", System.currentTimeMillis() - startedAt)
                status.lastError?.let { put("error", it) }
            },
        )
        emitStatus()
        if (changes.hasAny()) options.onChanges(changes)
    }

    /** One flush + pull; sets the status on success. */
    private suspend fun exchange(fullPull: Boolean, changes: RemoteChanges) {
        // A rejected op stays queued; its error must outlive the pull that
        // follows, or the status would claim everything synced.
        val pushError = flush(changes)
        pull(fullPull, changes)
        status = SyncStatus(
            phase = if (pushError != null) SyncPhase.ERROR else SyncPhase.IDLE,
            pendingOps = storage.outboxAll().size,
            lastSyncAt = options.now(),
            lastError = pushError,
        )
    }

    // ---- flush ----------------------------------------------------------------

    /** Pushes the outbox; returns the last non-network push error of this flush, or null. */
    private suspend fun flush(changes: RemoteChanges): String? {
        val entries = storage.outboxAll()
        if (entries.isEmpty()) return null

        // Coalesce: one op per LWW entity (newest editedAt wins), play events all.
        val byEntity = LinkedHashMap<String, OutboxEntry>()
        val stale = mutableListOf<String>()
        for (entry in entries) {
            val key = entry.op.payload.entityKey()
            val prev = byEntity[key]
            if (prev == null) {
                byEntity[key] = entry
            } else if (entry.op.payload.editedAt() >= prev.op.payload.editedAt()) {
                stale.add(prev.op.id)
                byEntity[key] = entry
            } else {
                stale.add(entry.op.id)
            }
        }
        if (stale.isNotEmpty()) {
            storage.outboxDelete(stale)
            crumb("flush.coalesced", mapOf("dropped" to stale.size, "surviving" to byEntity.size))
        }

        val survivors = byEntity.values.sortedWith(compareBy({ it.op.createdAt }, { it.op.id }))
        var pushError: String? = null
        for (entry in survivors) {
            try {
                pushOp(entry.op, changes)
                storage.outboxDelete(listOf(entry.op.id))
            } catch (err: SyncNetworkException) {
                throw err // offline: stop, keep everything
            } catch (err: SyncAuthException) {
                throw err // the session, not this op, was rejected: stop, no attempt bump
            } catch (err: Exception) {
                storage.outboxBumpAttempts(listOf(entry.op.id))
                // Non-network failure (constraint, bad payload): keep the op for a
                // later retry but let the rest of the queue through.
                val message = err.message ?: err.toString()
                crumb(
                    "flush.opFailed",
                    mapOf(
                        "kind" to entry.op.payload.kind(),
                        "opId" to entry.op.id,
                        "attempts" to entry.attempts + 1,
                        "error" to message,
                    ),
                )
                pushError = message
            }
        }
        return pushError
    }

    /**
     * Pushes one op with a conditional (LWW) write. When the op loses the
     * conflict, the winning remote row is applied locally via [changes] so the
     * UI converges instead of keeping the stale local value.
     */
    private suspend fun pushOp(op: SyncOp, changes: RemoteChanges) {
        when (val p = op.payload) {
            is SyncOpPayload.FavoriteSet -> {
                val trackId = resolveTrackRef(p.track) ?: return
                val remote = transport.getFavorite(trackId)
                if (remote != null && remote.editedAt > p.editedAt) {
                    crumb("flush.conflictLost", mapOf("kind" to p.kind(), "entity" to trackId))
                    applyFavoriteRow(remote, changes)
                    return
                }
                transport.upsertFavorite(trackId, p.favorite, p.editedAt)
                storage.shadowPut(
                    "favorites",
                    trackId,
                    SyncJson.encodeToString(
                        FavoriteRow.serializer(),
                        FavoriteRow(trackId = trackId, favorite = p.favorite, editedAt = p.editedAt),
                    ),
                )
            }

            is SyncOpPayload.RatingSet -> {
                val trackId = resolveTrackRef(p.track) ?: return
                val remote = transport.getRating(trackId)
                if (remote != null && remote.editedAt > p.editedAt) {
                    crumb("flush.conflictLost", mapOf("kind" to p.kind(), "entity" to trackId))
                    applyRatingRow(remote, changes)
                    return
                }
                transport.upsertRating(trackId, p.rating, p.editedAt)
                storage.shadowPut(
                    "ratings",
                    trackId,
                    SyncJson.encodeToString(
                        RatingRow.serializer(),
                        RatingRow(trackId = trackId, rating = p.rating, editedAt = p.editedAt),
                    ),
                )
            }

            is SyncOpPayload.PlaylistUpsertOp -> {
                val remote = transport.getPlaylist(p.playlist.id)
                if (remote != null && remote.editedAt > p.editedAt) {
                    crumb("flush.conflictLost", mapOf("kind" to p.kind(), "entity" to p.playlist.id))
                    applyPlaylistRow(remote, changes)
                    return
                }
                transport.upsertPlaylist(
                    PlaylistUpsert(
                        id = p.playlist.id,
                        parentId = p.playlist.parentId,
                        name = p.playlist.name,
                        isFolder = p.playlist.isFolder,
                        isSmart = p.playlist.isSmart,
                        smartRules = p.playlist.smartRules,
                        position = p.playlist.position,
                        editedAt = p.editedAt,
                        deletedAt = null, // an upsert always revives (rename-after-delete resurrects)
                    ),
                )
            }

            is SyncOpPayload.PlaylistDelete -> {
                val remote = transport.getPlaylist(p.playlistId) ?: return // never synced
                if (remote.editedAt > p.editedAt) {
                    crumb("flush.conflictLost", mapOf("kind" to p.kind(), "entity" to p.playlistId))
                    applyPlaylistRow(remote, changes)
                    return
                }
                transport.upsertPlaylist(
                    PlaylistUpsert(
                        id = remote.id,
                        parentId = remote.parentId,
                        name = remote.name,
                        isFolder = remote.isFolder,
                        isSmart = remote.isSmart,
                        smartRules = remote.smartRules,
                        position = remote.position,
                        editedAt = p.editedAt,
                        deletedAt = p.editedAt,
                    ),
                )
            }

            is SyncOpPayload.PlaylistItemAdd -> {
                val trackId = resolveTrackRef(p.track) ?: return
                if (!playlistExistsRemotely(p.playlistId)) return
                val items = transport.getPlaylistItems(p.playlistId)
                val existing = items.find { it.trackId == trackId }
                if (existing != null && existing.editedAt >= p.editedAt) return // newer state wins
                if (existing != null && existing.deletedAt == null) {
                    // Already live: touch edited_at in place so this add still beats an
                    // older concurrent remove, without moving the item.
                    transport.upsertPlaylistItem(
                        PlaylistItemUpsert(p.playlistId, trackId, existing.position, p.editedAt, null),
                    )
                    shadowPutItem(p.playlistId, trackId, existing.position, p.editedAt, null)
                    return
                }
                val position = positionForAdd(p, items)
                transport.upsertPlaylistItem(
                    PlaylistItemUpsert(p.playlistId, trackId, position, p.editedAt, null),
                )
                shadowPutItem(p.playlistId, trackId, position, p.editedAt, null)
            }

            is SyncOpPayload.PlaylistItemRemove -> {
                val trackId = resolveTrackRef(p.track) ?: return
                val items = transport.getPlaylistItems(p.playlistId)
                val existing = items.find { it.trackId == trackId }
                if (existing == null || existing.deletedAt != null) return
                if (existing.editedAt > p.editedAt) return // re-added later elsewhere
                transport.upsertPlaylistItem(
                    PlaylistItemUpsert(p.playlistId, trackId, existing.position, p.editedAt, p.editedAt),
                )
                shadowPutItem(p.playlistId, trackId, existing.position, p.editedAt, p.editedAt)
            }

            is SyncOpPayload.PlaylistReorder -> {
                val items = transport.getPlaylistItems(p.playlistId)
                val live = items.filter { it.deletedAt == null }.associateBy { it.trackId }
                val desired = mutableListOf<String>()
                for (ref in p.tracks) {
                    val id = resolveTrackRef(ref)
                    if (id != null && live.containsKey(id)) desired.add(id)
                }
                // Keep positions that already form an increasing subsequence of the
                // desired order (greedy); only out-of-place items get new keys, so
                // concurrent edits to untouched siblings survive.
                val kept = MutableList<String?>(desired.size) { null }
                var last = ""
                desired.forEachIndexed { i, trackId ->
                    val pos = live.getValue(trackId).position
                    if (last.isEmpty() || pos > last) {
                        kept[i] = pos
                        last = pos
                    }
                }
                var i = 0
                while (i < desired.size) {
                    if (kept[i] != null) {
                        i++
                        continue
                    }
                    var j = i
                    while (j < desired.size && kept[j] == null) j++
                    val prev = if (i > 0) kept[i - 1] else null
                    val next = if (j < desired.size) kept[j] else null
                    val keys = Fractional.nKeysBetween(prev, next, j - i)
                    for (k in i until j) {
                        kept[k] = keys[k - i]
                        val item = live.getValue(desired[k])
                        if (item.editedAt > p.editedAt) continue // that item moved later elsewhere
                        transport.upsertPlaylistItem(
                            PlaylistItemUpsert(p.playlistId, desired[k], keys[k - i], p.editedAt, null),
                        )
                        shadowPutItem(p.playlistId, desired[k], keys[k - i], p.editedAt, null)
                    }
                    i = j
                }
            }

            is SyncOpPayload.SettingSet -> {
                val remote = transport.getSetting(p.scope, p.key)
                if (remote != null && remote.editedAt > p.editedAt) {
                    crumb("flush.conflictLost", mapOf("kind" to p.kind(), "entity" to "${p.scope}/${p.key}"))
                    applySettingRow(remote, changes)
                    return
                }
                transport.upsertSetting(p.scope, p.key, p.value, p.editedAt)
                storage.shadowPut(
                    "settings",
                    "${p.scope}/${p.key}",
                    SyncJson.encodeToString(
                        SettingRow.serializer(),
                        SettingRow(scope = p.scope, key = p.key, value = p.value, editedAt = p.editedAt),
                    ),
                )
            }

            is SyncOpPayload.QueueSet -> {
                val remote = transport.pullQueueState()
                if (remote != null && remote.editedAt > p.editedAt) {
                    crumb("flush.conflictLost", mapOf("kind" to p.kind(), "entity" to "queue"))
                    applyQueueRow(remote, changes)
                    return
                }
                val trackIds = mutableListOf<String>()
                for (ref in p.tracks) {
                    resolveTrackRef(ref)?.let { trackIds.add(it) }
                }
                transport.upsertQueueState(
                    QueueStateUpsert(
                        deviceId = op.deviceId,
                        trackIds = trackIds,
                        currentIndex = minOf(p.currentIndex, maxOf(0, trackIds.size - 1)),
                        positionSeconds = p.positionSeconds,
                        shuffle = p.shuffle,
                        repeat = p.repeat,
                        editedAt = p.editedAt,
                    ),
                )
            }

            is SyncOpPayload.TrackEditOp -> {
                val trackId = resolveTrackRef(p.track) ?: return
                val row = transport.applyTrackEdit(trackId, p.patch, p.editedAt)
                if (row == null) {
                    // Deleted elsewhere: the edit has nothing to apply to, so drop it.
                    crumb("flush.opFailed", mapOf("kind" to p.kind(), "opId" to op.id, "error" to "track not found (dropped)"))
                    return
                }
                val at = instantOf(p.editedAt)
                val lost = p.patch.keys.filter { f -> row.fieldEditedAt[f]?.let { instantOf(it) > at } == true }
                if (lost.isNotEmpty()) {
                    crumb("flush.conflictLost", mapOf("kind" to p.kind(), "entity" to trackId, "fields" to lost.joinToString(",")))
                }
                cacheTrack(row)
                changes.tracksChanged = true
            }

            is SyncOpPayload.PlayEventAdd -> {
                val trackId = resolveTrackRef(p.track) ?: return
                transport.insertPlayEvent(
                    PlayEventInsert(
                        id = p.eventId,
                        trackId = trackId,
                        deviceId = op.deviceId,
                        playedAt = p.playedAt,
                        durationPlayed = p.durationPlayed,
                        completed = p.completed,
                    ),
                )
            }
        }
    }

    private suspend fun positionForAdd(
        p: SyncOpPayload.PlaylistItemAdd,
        items: List<PlaylistItemRow>,
    ): String {
        val live = items.filter { it.deletedAt == null }.sortedBy { it.position }
        suspend fun posOf(ref: TrackRef?): String? {
            if (ref == null) return null
            val id = resolveTrackRef(ref) ?: return null
            return live.find { it.trackId == id }?.position
        }

        val prev = posOf(p.prevTrack)
        if (prev != null) {
            val next = live.find { it.position > prev }?.position
            return Fractional.keyBetween(prev, next)
        }
        val next = posOf(p.nextTrack)
        if (next != null) {
            val before = live.lastOrNull { it.position < next }?.position
            return Fractional.keyBetween(before, next)
        }
        // No usable anchors — append.
        return Fractional.keyBetween(live.lastOrNull()?.position, null)
    }

    private suspend fun playlistExistsRemotely(playlistId: String): Boolean {
        val shadow = storage.shadowGet("playlists", playlistId)
        if (shadow != null) {
            val row = SyncJson.decodeFromString(PlaylistRow.serializer(), shadow)
            if (row.deletedAt == null) return true
        }
        val remote = transport.getPlaylist(playlistId)
        if (remote != null) {
            storage.shadowPut("playlists", playlistId, SyncJson.encodeToString(PlaylistRow.serializer(), remote))
        }
        return remote != null && remote.deletedAt == null
    }

    private suspend fun shadowPutItem(
        playlistId: String,
        trackId: String,
        position: String,
        editedAt: String,
        deletedAt: String?,
    ) {
        storage.shadowPut(
            "playlist_items/$playlistId",
            trackId,
            SyncJson.encodeToString(
                PlaylistItemRow.serializer(),
                PlaylistItemRow(playlistId, trackId, position, editedAt, deletedAt),
            ),
        )
    }

    // ---- track ref resolution ---------------------------------------------------

    private fun SyncOpPayload.isSyncable(): Boolean = when (this) {
        is SyncOpPayload.FavoriteSet -> track.hasIdentity()
        is SyncOpPayload.RatingSet -> track.hasIdentity()
        is SyncOpPayload.PlaylistItemAdd -> track.hasIdentity()
        is SyncOpPayload.PlaylistItemRemove -> track.hasIdentity()
        is SyncOpPayload.PlayEventAdd -> track.hasIdentity()
        is SyncOpPayload.TrackEditOp -> track.hasIdentity() && TrackEdit.isValidPatch(patch)
        else -> true
    }

    /**
     * TrackRef → remote tracks.id. Uses the warm identity maps, then the
     * server, then creates a minimal canonical row. Returns null only for
     * identity-less refs (defensive — enqueue already rejects those).
     */
    private suspend fun resolveTrackRef(ref: TrackRef): String? {
        if (ref.remoteId != null) return canonical(ref.remoteId)
        val hash = ref.contentHash ?: return null
        trackByHash[hash]?.let { return canonical(it) }

        val remote = transport.getTrackByHash(hash)
        if (remote != null) {
            cacheTrack(remote)
            return canonical(remote.id)
        }
        val stem = ref.fileName?.replace(Regex("\\.[^.]+$"), "")
        val created = transport.insertTrack(
            TrackInsertMinimal(
                contentHash = hash,
                fileName = ref.fileName ?: ref.title ?: "unknown",
                fileSize = ref.fileSize ?: 0,
                title = ref.title ?: stem ?: "Unknown",
                artist = ref.artist ?: "",
                album = ref.album ?: "",
                duration = ref.duration ?: 0.0,
            ),
        )
        cacheTrack(created)
        return created.id
    }

    private suspend fun cacheTrack(row: TrackRow) {
        storage.shadowPut("tracks", row.id, SyncJson.encodeToString(TrackRow.serializer(), row))
        indexTrack(row)
    }

    private fun indexTrack(row: TrackRow) {
        trackById[row.id] = TrackIdentity(remoteId = row.id, contentHash = row.contentHash)
        row.contentHash?.let { trackByHash[it] = row.id }
        row.mergedInto?.let { mergedInto[row.id] = it }
    }

    private fun unindexTrack(id: String) {
        val ident = trackById.remove(id)
        mergedInto.remove(id)
        ident?.contentHash?.let { if (trackByHash[it] == id) trackByHash.remove(it) }
    }

    /**
     * Follows merge tombstones to the surviving row, so an op queued against a
     * duplicate lands on the track that absorbed its history.
     */
    private fun canonical(trackId: String): String {
        var id = trackId
        repeat(8) { id = mergedInto[id] ?: return id }
        return id
    }

    /** ISO timestamp → instant; accepts both "Z" and the server's "+00:00". */
    private fun instantOf(iso: String): Instant = java.time.OffsetDateTime.parse(iso).toInstant()

    private fun identity(trackId: String): TrackIdentity =
        trackById[trackId] ?: TrackIdentity(remoteId = trackId, contentHash = null)

    // ---- pull -------------------------------------------------------------------

    private suspend fun pull(full: Boolean, changes: RemoteChanges) {
        // Newest pending editedAt per entity key: local unflushed edits win locally.
        val pendingNewest = HashMap<String, String>()
        for ((op, _) in storage.outboxAll().map { it.op to it.attempts }) {
            val editedAt = op.payload.editedAt()
            val keys = mutableListOf(op.payload.entityKey())
            // Track-keyed ops can be known under several identities; index them all.
            when (val p = op.payload) {
                is SyncOpPayload.FavoriteSet -> keys.addAll(p.track.keys().map { "favorite/$it" })
                is SyncOpPayload.RatingSet -> keys.addAll(p.track.keys().map { "rating/$it" })
                is SyncOpPayload.PlaylistItemAdd ->
                    keys.addAll(p.track.keys().map { "playlistItem/${p.playlistId}/$it" })
                is SyncOpPayload.PlaylistItemRemove ->
                    keys.addAll(p.track.keys().map { "playlistItem/${p.playlistId}/$it" })
                else -> {}
            }
            for (key in keys) {
                val prev = pendingNewest[key]
                if (prev == null || editedAt > prev) pendingNewest[key] = editedAt
            }
        }

        fun pendingWins(keys: List<String>, rowEditedAt: String): Boolean =
            keys.any { key -> pendingNewest[key]?.let { it >= rowEditedAt } == true }

        fun keysFor(prefix: String, trackId: String): List<String> {
            val ident = identity(trackId)
            return TrackRef(remoteId = trackId, contentHash = ident.contentHash).keys().map { "$prefix/$it" }
        }

        suspend fun cursorOf(name: String): String? = if (full) null else storage.cursorGet(name)

        // tracks — first, so every later table can resolve track ids.
        run {
            val rows = transport.pullTracks(cursorOf("tracks"))
            for (row in rows) cacheTrack(row)
            if (rows.isNotEmpty()) {
                changes.tracksChanged = true
                storage.cursorSet("tracks", rows.last().updatedAt)
            }
            // A full pull is the whole table: drop shadow rows the server no longer
            // has (hard-deleted before tombstones existed), so the shadow is exact.
            if (full) {
                val live = rows.mapTo(HashSet()) { it.id }
                for (shadow in storage.shadowAll("tracks")) {
                    if (shadow.id in live) continue
                    storage.shadowDelete("tracks", shadow.id)
                    unindexTrack(shadow.id)
                    changes.tracksChanged = true
                }
            }
        }

        // playlists
        run {
            val rows = transport.pullPlaylists(cursorOf("playlists"))
            for (row in rows) {
                if (!pendingWins(listOf("playlist/${row.id}"), row.editedAt)) {
                    applyPlaylistRow(row, changes)
                }
            }
            if (rows.isNotEmpty()) storage.cursorSet("playlists", rows.last().updatedAt)
        }

        // playlist_items
        run {
            val rows = transport.pullPlaylistItems(cursorOf("playlist_items"))
            val touched = mutableSetOf<String>()
            for (row in rows) {
                val keys = keysFor("playlistItem/${row.playlistId}", row.trackId) +
                    "playlistReorder/${row.playlistId}"
                if (pendingWins(keys, row.editedAt)) continue
                shadowPutItem(row.playlistId, row.trackId, row.position, row.editedAt, row.deletedAt)
                touched.add(row.playlistId)
            }
            for (playlistId in touched) {
                changes.playlistItems.add(orderedItems(playlistId))
            }
            if (rows.isNotEmpty()) storage.cursorSet("playlist_items", rows.last().updatedAt)
        }

        // favorites
        run {
            val rows = transport.pullFavorites(cursorOf("favorites"))
            for (row in rows) {
                if (!pendingWins(keysFor("favorite", row.trackId), row.editedAt)) {
                    applyFavoriteRow(row, changes)
                }
            }
            if (rows.isNotEmpty()) storage.cursorSet("favorites", rows.last().updatedAt)
        }

        // ratings
        run {
            val rows = transport.pullRatings(cursorOf("ratings"))
            for (row in rows) {
                if (!pendingWins(keysFor("rating", row.trackId), row.editedAt)) {
                    applyRatingRow(row, changes)
                }
            }
            if (rows.isNotEmpty()) storage.cursorSet("ratings", rows.last().updatedAt)
        }

        // settings
        run {
            val rows = transport.pullSettings(cursorOf("settings"))
            for (row in rows) {
                if (!pendingWins(listOf("setting/${row.scope}/${row.key}"), row.editedAt)) {
                    applySettingRow(row, changes)
                }
            }
            if (rows.isNotEmpty()) storage.cursorSet("settings", rows.last().updatedAt)
        }

        // queue_state — one row; emit only when it changed since last seen.
        run {
            val row = transport.pullQueueState()
            if (row != null) {
                val seen = storage.shadowGet("queue", "singleton")
                val seenEditedAt = seen?.let { SyncJson.decodeFromString(QueueStateRow.serializer(), it).editedAt }
                if (seenEditedAt != row.editedAt && !pendingWins(listOf("queue"), row.editedAt)) {
                    applyQueueRow(row, changes)
                }
            }
        }

        // play_events — append-only stream into the shadow (Phase 7 consumes it).
        run {
            val rows = transport.pullPlayEvents(cursorOf("play_events"))
            for (row in rows) {
                storage.shadowPut("play_events", row.id, SyncJson.encodeToString(PlayEventRow.serializer(), row))
            }
            changes.playEventsAdded += rows.size
            if (rows.isNotEmpty()) storage.cursorSet("play_events", rows.last().createdAt)
        }
    }

    /** Live items of a playlist from the shadow, in fractional-position order. */
    suspend fun orderedItems(playlistId: String): PlaylistItemsChange {
        val rows = storage.shadowAll("playlist_items/$playlistId")
            .map { SyncJson.decodeFromString(PlaylistItemRow.serializer(), it.payload) }
        val tracks = rows
            .filter { it.deletedAt == null }
            .sortedWith(compareBy({ it.position }, { it.trackId }))
            .map { identity(it.trackId) }
        return PlaylistItemsChange(playlistId, tracks)
    }

    // ---- row application (shared by pull and lost-conflict paths) ----------------

    private suspend fun applyFavoriteRow(row: FavoriteRow, changes: RemoteChanges) {
        storage.shadowPut("favorites", row.trackId, SyncJson.encodeToString(FavoriteRow.serializer(), row))
        changes.favorites.add(FavoriteChange(identity(row.trackId), row.favorite, row.editedAt))
    }

    private suspend fun applyRatingRow(row: RatingRow, changes: RemoteChanges) {
        storage.shadowPut("ratings", row.trackId, SyncJson.encodeToString(RatingRow.serializer(), row))
        changes.ratings.add(RatingChange(identity(row.trackId), row.rating, row.editedAt))
    }

    private suspend fun applyPlaylistRow(row: PlaylistRow, changes: RemoteChanges) {
        storage.shadowPut("playlists", row.id, SyncJson.encodeToString(PlaylistRow.serializer(), row))
        changes.playlists.add(
            PlaylistChange(
                id = row.id,
                parentId = row.parentId,
                name = row.name,
                isFolder = row.isFolder,
                isSmart = row.isSmart,
                smartRules = row.smartRules,
                position = row.position,
                deleted = row.deletedAt != null,
                editedAt = row.editedAt,
            ),
        )
    }

    private suspend fun applySettingRow(row: SettingRow, changes: RemoteChanges) {
        storage.shadowPut("settings", "${row.scope}/${row.key}", SyncJson.encodeToString(SettingRow.serializer(), row))
        changes.settings.add(SettingChange(row.scope, row.key, row.value, row.editedAt))
    }

    private suspend fun applyQueueRow(row: QueueStateRow, changes: RemoteChanges) {
        storage.shadowPut("queue", "singleton", SyncJson.encodeToString(QueueStateRow.serializer(), row))
        changes.queue = QueueChange(
            tracks = row.trackIds.map { identity(it) },
            currentIndex = row.currentIndex,
            positionSeconds = row.positionSeconds,
            shuffle = row.shuffle,
            repeat = row.repeat,
            deviceId = row.deviceId,
            editedAt = row.editedAt,
        )
    }

    // ---- misc ---------------------------------------------------------------------

    private fun setPhase(phase: SyncPhase) {
        status = status.copy(phase = phase)
        emitStatus()
    }

    private fun emitStatus() {
        options.onStatus(status)
    }

    private companion object {
        const val REALTIME_DEBOUNCE_MS = 800L
    }
}
