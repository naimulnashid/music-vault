package com.musicvault.data.sync

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Test
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.Instant

/**
 * 1:1 port of packages/core/tests/syncEngine.test.ts — the conflict semantics
 * locked by docs/sync-protocol.md. Change semantics there and here in
 * lockstep with the TS suite.
 */
class SyncEngineTest {

    // ---- deterministic clock helpers ------------------------------------------

    private val isoMillis: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** 2026-01-01T00:00:00Z, matching the TS suite's Date.UTC(2026, 0, 1). */
    private val base: Long = Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()

    /** ts(n): a stable ISO timestamp n seconds after the epoch base. */
    private fun ts(n: Int): String = isoMillis.format(Instant.ofEpochMilli(base + n * 1000L))

    // ---- fake server + transport ----------------------------------------------
    // One FakeServer, one FakeTransport per simulated device. The server assigns
    // updated_at/created_at from a logical clock, mirroring the Postgres triggers.

    private inner class FakeServer {
        private var clock = 0
        val tracks = LinkedHashMap<String, TrackRow>()
        val favorites = LinkedHashMap<String, FavoriteRow>()
        val ratings = LinkedHashMap<String, RatingRow>()
        val playlists = LinkedHashMap<String, PlaylistRow>()
        val items = LinkedHashMap<String, PlaylistItemRow>()
        val settings = LinkedHashMap<String, SettingRow>()
        var queue: QueueStateRow? = null
        val playEvents = LinkedHashMap<String, PlayEventRow>()
        private var nextTrackId = 1

        fun tick(): String {
            clock += 1
            return isoMillis.format(Instant.ofEpochMilli(base + 1_000_000_000L + clock * 1000L))
        }

        fun newTrackId(): String = "track-${nextTrackId++}"

        fun itemsOf(playlistId: String): List<PlaylistItemRow> =
            items.values.filter { it.playlistId == playlistId }

        /** Live track ids of a playlist in fractional order — the merged truth. */
        fun order(playlistId: String): List<String> =
            itemsOf(playlistId)
                .filter { it.deletedAt == null }
                .sortedBy { it.position }
                .map { it.trackId }
    }

    private inner class FakeTransport(private val server: FakeServer) : SyncTransport {
        var offline = false

        /** When set, favorite pushes fail with this non-network error (a rejected write). */
        var favoriteError: String? = null

        /** When set, every request is rejected as the server does a stale token (401). */
        var authRejected = false

        /** When false, [refreshAuth] fails as it does for a revoked refresh token. */
        var refreshWorks = true
        var refreshCalls = 0

        /** Requests that reached the server, rejected or not. */
        var requests = 0

        private fun guard() {
            if (offline) throw SyncNetworkException("fetch failed (offline)")
            requests++
            if (authRejected) throw SyncAuthException("JWT expired")
        }

        override suspend fun refreshAuth() {
            refreshCalls++
            if (!refreshWorks) throw IllegalStateException("Invalid Refresh Token")
            authRejected = false
        }

        private fun <T> pulled(rows: List<T>, column: (T) -> String, since: String?): List<T> =
            rows.filter { since == null || column(it) > since }.sortedBy(column)

        override suspend fun pullTracks(since: String?): List<TrackRow> {
            guard()
            return pulled(server.tracks.values.toList(), { it.updatedAt }, since)
        }

        override suspend fun pullPlaylists(since: String?): List<PlaylistRow> {
            guard()
            return pulled(server.playlists.values.toList(), { it.updatedAt }, since)
        }

        override suspend fun pullPlaylistItems(since: String?): List<PlaylistItemRow> {
            guard()
            return pulled(server.items.values.toList(), { it.updatedAt }, since)
        }

        override suspend fun pullFavorites(since: String?): List<FavoriteRow> {
            guard()
            return pulled(server.favorites.values.toList(), { it.updatedAt }, since)
        }

        override suspend fun pullRatings(since: String?): List<RatingRow> {
            guard()
            return pulled(server.ratings.values.toList(), { it.updatedAt }, since)
        }

        override suspend fun pullSettings(since: String?): List<SettingRow> {
            guard()
            return pulled(server.settings.values.toList(), { it.updatedAt }, since)
        }

        override suspend fun pullQueueState(): QueueStateRow? {
            guard()
            return server.queue
        }

        override suspend fun pullPlayEvents(since: String?): List<PlayEventRow> {
            guard()
            return pulled(server.playEvents.values.toList(), { it.createdAt }, since)
        }

        override suspend fun getTrackByHash(contentHash: String): TrackRow? {
            guard()
            return server.tracks.values.firstOrNull { it.contentHash == contentHash }
        }

        override suspend fun insertTrack(row: TrackInsertMinimal): TrackRow {
            guard()
            getTrackByHash(row.contentHash)?.let { return it }
            val track = TrackRow(
                id = server.newTrackId(),
                contentHash = row.contentHash,
                fileName = row.fileName,
                fileSize = row.fileSize,
                title = row.title,
                artist = row.artist,
                album = row.album,
                duration = row.duration,
                createdAt = server.tick(),
                updatedAt = server.tick(),
            )
            server.tracks[track.id] = track
            return track
        }

        var applyEditCalls = 0

        override suspend fun applyTrackEdit(trackId: String, patch: JsonObject, editedAt: String): TrackRow? {
            guard()
            applyEditCalls++
            val row = server.tracks[trackId]
            if (row == null || row.deletedAt != null) return null // apply_track_edit raises P0002
            val next = TrackEdit.apply(row, patch, editedAt).copy(updatedAt = server.tick())
            server.tracks[trackId] = next
            return next
        }

        override suspend fun getFavorite(trackId: String): FavoriteRow? {
            guard()
            return server.favorites[trackId]
        }

        override suspend fun upsertFavorite(trackId: String, favorite: Boolean, editedAt: String) {
            guard()
            favoriteError?.let { throw IllegalStateException(it) }
            server.favorites[trackId] = FavoriteRow(
                trackId = trackId,
                favorite = favorite,
                editedAt = editedAt,
                updatedAt = server.tick(),
            )
        }

        override suspend fun getRating(trackId: String): RatingRow? {
            guard()
            return server.ratings[trackId]
        }

        override suspend fun upsertRating(trackId: String, rating: Int, editedAt: String) {
            guard()
            server.ratings[trackId] = RatingRow(
                trackId = trackId,
                rating = rating,
                editedAt = editedAt,
                updatedAt = server.tick(),
            )
        }

        override suspend fun getPlaylist(id: String): PlaylistRow? {
            guard()
            return server.playlists[id]
        }

        override suspend fun upsertPlaylist(row: PlaylistUpsert) {
            guard()
            server.playlists[row.id] = PlaylistRow(
                id = row.id,
                parentId = row.parentId,
                name = row.name,
                isFolder = row.isFolder,
                isSmart = row.isSmart,
                smartRules = row.smartRules,
                position = row.position,
                editedAt = row.editedAt,
                deletedAt = row.deletedAt,
                updatedAt = server.tick(),
            )
        }

        override suspend fun getPlaylistItems(playlistId: String): List<PlaylistItemRow> {
            guard()
            return server.itemsOf(playlistId)
        }

        override suspend fun upsertPlaylistItem(row: PlaylistItemUpsert) {
            guard()
            val key = "${row.playlistId}/${row.trackId}"
            server.items[key] = PlaylistItemRow(
                playlistId = row.playlistId,
                trackId = row.trackId,
                position = row.position,
                editedAt = row.editedAt,
                deletedAt = row.deletedAt,
                updatedAt = server.tick(),
            )
        }

        override suspend fun getSetting(scope: String, key: String): SettingRow? {
            guard()
            return server.settings["$scope/$key"]
        }

        override suspend fun upsertSetting(scope: String, key: String, value: JsonElement, editedAt: String) {
            guard()
            server.settings["$scope/$key"] = SettingRow(
                scope = scope,
                key = key,
                value = value,
                editedAt = editedAt,
                updatedAt = server.tick(),
            )
        }

        override suspend fun upsertQueueState(row: QueueStateUpsert) {
            guard()
            server.queue = QueueStateRow(
                deviceId = row.deviceId,
                trackIds = row.trackIds,
                currentIndex = row.currentIndex,
                positionSeconds = row.positionSeconds,
                shuffle = row.shuffle,
                repeat = row.repeat,
                editedAt = row.editedAt,
                updatedAt = server.tick(),
            )
        }

        override suspend fun insertPlayEvent(row: PlayEventInsert) {
            guard()
            if (server.playEvents.containsKey(row.id)) return // on conflict do nothing
            server.playEvents[row.id] = PlayEventRow(
                id = row.id,
                trackId = row.trackId,
                deviceId = row.deviceId,
                playedAt = row.playedAt,
                durationPlayed = row.durationPlayed,
                completed = row.completed,
                createdAt = server.tick(),
            )
        }

        override fun subscribe(onChange: () -> Unit): () -> Unit = {}
    }

    // ---- device harness ---------------------------------------------------------

    private inner class Device(server: FakeServer, name: String, scope: CoroutineScope) {
        val transport = FakeTransport(server)
        val storage = MemorySyncStorage()
        val changes = mutableListOf<RemoteChanges>()
        private var clock = 0
        val engine = SyncEngine(
            transport,
            storage,
            SyncEngine.Options(
                deviceId = name,
                scope = scope,
                now = { ts(clock++) },
                uuid = { "$name-op-${++opSeq}" },
                autoSync = false, // tests sequence cycles explicitly for determinism
                onChanges = { changes.add(it) },
            ),
        )

        fun favoriteChanges(): List<FavoriteChange> = changes.flatMap { it.favorites }
        fun ratingChanges(): List<RatingChange> = changes.flatMap { it.ratings }
    }

    private var opSeq = 0

    private inner class Harness(val scope: CoroutineScope) {
        val server = FakeServer()
        val a = Device(server, "A", scope)
        val b = Device(server, "B", scope)

        suspend fun init() {
            a.engine.init()
            b.engine.init()
        }

        fun idOf(hash: String): String =
            server.tracks.values.first { it.contentHash == hash }.id
    }

    private fun syncTest(block: suspend Harness.() -> Unit) = runTest {
        opSeq = 0
        val harness = Harness(this)
        harness.init()
        harness.block()
    }

    private fun hashRef(n: Int): TrackRef = TrackRef(
        contentHash = "hash-$n",
        fileName = "Song $n.flac",
        fileSize = 1000L + n,
        title = "Song $n",
        artist = "Artist",
        album = "Album",
        duration = 180.0,
    )

    private fun str(value: String): JsonElement = JsonPrimitive(value)

    // ---- tests --------------------------------------------------------------------

    @Test
    fun `flushes a favorite and creates the canonical track row on demand`() = syncTest {
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()

        assertThat(server.tracks).hasSize(1)
        val track = server.tracks.values.first()
        assertThat(track.contentHash).isEqualTo("hash-1")
        assertThat(track.title).isEqualTo("Song 1")
        assertThat(server.favorites[track.id]?.favorite).isTrue()
        assertThat(a.storage.outboxAll()).isEmpty()
    }

    @Test
    fun `two devices favoriting the same unpublished track converge on one row`() = syncTest {
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        b.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(11)))
        a.engine.syncNow()
        b.engine.syncNow()
        assertThat(server.tracks).hasSize(1)
        assertThat(server.favorites).hasSize(1)
    }

    @Test
    fun `replaying an already-pushed op is idempotent`() = syncTest {
        val op = SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10))
        a.engine.enqueue(op)
        a.engine.syncNow()

        // Simulate a crash after the push but before the outbox delete: the same
        // envelope is still queued on restart and flushes again.
        a.storage.outboxPut(SyncOp(id = "A-op-crash", deviceId = "A", createdAt = ts(0), payload = op))
        a.engine.syncNow()

        assertThat(server.tracks).hasSize(1)
        assertThat(server.favorites).hasSize(1)
        assertThat(server.favorites.values.first().favorite).isTrue()
    }

    @Test
    fun `rating conflict - the later edit wins regardless of flush order`() = syncTest {
        // B edits first in wall-clock time, A edits later; B flushes LAST.
        a.engine.enqueue(SyncOpPayload.RatingSet(hashRef(1), rating = 3, editedAt = ts(20)))
        b.engine.enqueue(SyncOpPayload.RatingSet(hashRef(1), rating = 5, editedAt = ts(15)))
        a.engine.syncNow()
        b.engine.syncNow()

        val track = server.tracks.values.first()
        assertThat(server.ratings[track.id]?.rating).isEqualTo(3)
        // B's losing op was dropped AND B was handed the winning value to apply.
        assertThat(b.ratingChanges().any { it.rating == 3 }).isTrue()
        assertThat(b.storage.outboxAll()).isEmpty()
    }

    @Test
    fun `outbox coalesces repeated edits of the same entity`() = syncTest {
        a.engine.enqueue(SyncOpPayload.RatingSet(hashRef(1), rating = 1, editedAt = ts(10)))
        a.engine.enqueue(SyncOpPayload.RatingSet(hashRef(1), rating = 2, editedAt = ts(11)))
        a.engine.enqueue(SyncOpPayload.RatingSet(hashRef(1), rating = 4, editedAt = ts(12)))
        a.engine.syncNow()
        val track = server.tracks.values.first()
        assertThat(server.ratings[track.id]?.rating).isEqualTo(4)
    }

    @Test
    fun `a restart that starts offline still knows when this device last synced`() = syncTest {
        a.engine.syncNow()
        val lastSyncAt = a.engine.getStatus().lastSyncAt
        assertThat(lastSyncAt).isNotNull()

        // Same storage, new engine: the in-memory status starts empty.
        val transport = FakeTransport(server).apply { offline = true }
        val restarted = SyncEngine(
            transport,
            a.storage,
            SyncEngine.Options(deviceId = "A", scope = scope, now = { ts(999) }, uuid = { "x" }, autoSync = false),
        )
        restarted.init()
        restarted.syncNow()
        assertThat(restarted.getStatus().phase).isEqualTo(SyncPhase.OFFLINE)
        assertThat(restarted.getStatus().lastSyncAt).isEqualTo(lastSyncAt)
    }

    @Test
    fun `a rejected push keeps the status in error after a successful pull`() = syncTest {
        a.transport.favoriteError = "constraint violated"
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()
        val failed = a.engine.getStatus()
        assertThat(failed.phase).isEqualTo(SyncPhase.ERROR)
        assertThat(failed.pendingOps).isEqualTo(1)
        assertThat(failed.lastError).isEqualTo("constraint violated")
        assertThat(failed.lastSyncAt).isNotNull()

        a.transport.favoriteError = null
        a.engine.syncNow()
        val recovered = a.engine.getStatus()
        assertThat(recovered.phase).isEqualTo(SyncPhase.IDLE)
        assertThat(recovered.pendingOps).isEqualTo(0)
        assertThat(recovered.lastError).isNull()
        assertThat(server.favorites).hasSize(1)
    }

    @Test
    fun `offline - ops queue, survive, and flush on reconnect`() = syncTest {
        a.transport.offline = true
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()
        assertThat(a.engine.getStatus().phase).isEqualTo(SyncPhase.OFFLINE)
        assertThat(a.storage.outboxAll()).hasSize(1)
        assertThat(server.favorites).isEmpty()

        a.transport.offline = false
        a.engine.syncNow()
        assertThat(a.engine.getStatus().phase).isEqualTo(SyncPhase.IDLE)
        assertThat(server.favorites).hasSize(1)
        assertThat(a.storage.outboxAll()).isEmpty()
    }

    // Auth recovery is Android-only so far; the TS suite has no counterpart yet.

    @Test
    fun `a rejected session refreshes once and the cycle succeeds`() = syncTest {
        a.transport.authRejected = true
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()

        assertThat(a.transport.refreshCalls).isEqualTo(1)
        assertThat(a.engine.getStatus().phase).isEqualTo(SyncPhase.IDLE)
        assertThat(a.engine.needsSession).isFalse()
        assertThat(server.favorites).hasSize(1)
        assertThat(a.storage.outboxAll()).isEmpty()
    }

    @Test
    fun `a failed refresh keeps ops queued unbumped and waits for a new session`() = syncTest {
        a.transport.authRejected = true
        a.transport.refreshWorks = false
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()

        val status = a.engine.getStatus()
        assertThat(status.phase).isEqualTo(SyncPhase.AUTH)
        assertThat(status.pendingOps).isEqualTo(1)
        assertThat(a.transport.refreshCalls).isEqualTo(1)
        assertThat(a.storage.outboxAll().single().attempts).isEqualTo(0)
        assertThat(server.favorites).isEmpty()
        assertThat(a.engine.needsSession).isTrue()

        // Later kicks don't hammer the server with the dead token.
        val requests = a.transport.requests
        a.engine.syncNow()
        assertThat(a.transport.requests).isEqualTo(requests)
        assertThat(a.transport.refreshCalls).isEqualTo(1)

        // Signed in again: the queued op goes out.
        a.transport.authRejected = false
        a.engine.resume()
        a.engine.syncNow()
        assertThat(a.engine.getStatus().phase).isEqualTo(SyncPhase.IDLE)
        assertThat(server.favorites).hasSize(1)
        assertThat(a.storage.outboxAll()).isEmpty()
    }

    @Test
    fun `no flush or pull runs while paused for a missing session`() = syncTest {
        a.engine.pause()
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()
        a.engine.syncNow(fullPull = true)

        assertThat(a.transport.requests).isEqualTo(0)
        assertThat(a.storage.outboxAll()).hasSize(1)
        assertThat(a.engine.getStatus().pendingOps).isEqualTo(1)

        a.engine.resume()
        a.engine.syncNow()
        assertThat(server.favorites).hasSize(1)
        assertThat(a.storage.outboxAll()).isEmpty()
    }

    @Test
    fun `pull applies the other device's favorite and advances the cursor`() = syncTest {
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()

        b.engine.syncNow()
        val seen = b.favoriteChanges()
        assertThat(seen).hasSize(1)
        assertThat(seen[0].favorite).isTrue()
        assertThat(seen[0].track.contentHash).isEqualTo("hash-1")

        // Nothing new: a second cycle emits no further changes.
        val countBefore = b.changes.size
        b.engine.syncNow()
        assertThat(b.changes).hasSize(countBefore)
    }

    @Test
    fun `pull does not clobber a newer pending local edit`() = syncTest {
        a.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = true, editedAt = ts(10)))
        a.engine.syncNow()
        b.engine.syncNow() // B now knows the track + favorite

        // B unfavorites while offline; A's older state must not overwrite it on pull.
        b.transport.offline = true
        b.engine.enqueue(SyncOpPayload.FavoriteSet(hashRef(1), favorite = false, editedAt = ts(30)))
        b.engine.syncNow()
        b.transport.offline = false

        val before = b.favoriteChanges().size
        b.engine.syncNow(fullPull = true)
        val applied = b.favoriteChanges().drop(before)
        assertThat(applied.all { !it.favorite }).isTrue()

        val track = server.tracks.values.first()
        assertThat(server.favorites[track.id]?.favorite).isFalse()
    }

    @Test
    fun `playlist delete vs later rename - the rename resurrects the playlist`() = syncTest {
        val playlist = PlaylistSnapshot(id = "pl-1", name = "Road Trip")
        a.engine.enqueue(SyncOpPayload.PlaylistUpsertOp(playlist, editedAt = ts(10)))
        a.engine.syncNow()
        b.engine.syncNow()

        a.engine.enqueue(SyncOpPayload.PlaylistDelete("pl-1", editedAt = ts(20)))
        b.engine.enqueue(
            SyncOpPayload.PlaylistUpsertOp(playlist.copy(name = "Road Trip 2026"), editedAt = ts(25)),
        )
        a.engine.syncNow()
        b.engine.syncNow()
        a.engine.syncNow()

        val row = server.playlists.getValue("pl-1")
        assertThat(row.deletedAt).isNull()
        assertThat(row.name).isEqualTo("Road Trip 2026")
        // A saw the resurrection via pull.
        val playlistChanges = a.changes.flatMap { it.playlists }
        assertThat(playlistChanges.last().name).isEqualTo("Road Trip 2026")
        assertThat(playlistChanges.last().deleted).isFalse()
    }

    // ---- playlist items -------------------------------------------------------

    private val mixPlaylist = PlaylistSnapshot(id = "pl-1", name = "Mix")

    /** Seeds pl-1 with Song 1..3 from device A and syncs both devices. */
    private suspend fun Harness.seedPlaylist() {
        a.engine.enqueue(SyncOpPayload.PlaylistUpsertOp(mixPlaylist, editedAt = ts(1)))
        for (n in 1..3) {
            a.engine.enqueue(
                SyncOpPayload.PlaylistItemAdd(playlistId = "pl-1", track = hashRef(n), editedAt = ts(1 + n)),
            )
        }
        a.engine.syncNow()
        b.engine.syncNow()
    }

    @Test
    fun `adds append in enqueue order`() = syncTest {
        seedPlaylist()
        assertThat(server.order("pl-1"))
            .containsExactly(idOf("hash-1"), idOf("hash-2"), idOf("hash-3"))
            .inOrder()
    }

    @Test
    fun `concurrent reorder + add merge - both intents survive`() = syncTest {
        seedPlaylist()

        // A moves Song 3 to the front; B appends Song 4 after Song 3 — offline.
        a.transport.offline = true
        b.transport.offline = true
        a.engine.enqueue(
            SyncOpPayload.PlaylistReorder(
                playlistId = "pl-1",
                tracks = listOf(hashRef(3), hashRef(1), hashRef(2)),
                editedAt = ts(40),
            ),
        )
        b.engine.enqueue(
            SyncOpPayload.PlaylistItemAdd(
                playlistId = "pl-1",
                track = hashRef(4),
                prevTrack = hashRef(3),
                editedAt = ts(41),
            ),
        )
        a.engine.syncNow()
        b.engine.syncNow()

        a.transport.offline = false
        b.transport.offline = false
        a.engine.syncNow()
        b.engine.syncNow()
        a.engine.syncNow() // A pulls B's addition

        // B's "after Song 3" anchor lands inside A's new order.
        assertThat(server.order("pl-1"))
            .containsExactly(idOf("hash-3"), idOf("hash-4"), idOf("hash-1"), idOf("hash-2"))
            .inOrder()
        // Both devices converge on the merged order via their shadows.
        val aItems = a.engine.orderedItems("pl-1")
        assertThat(aItems.tracks.map { it.remoteId }).isEqualTo(server.order("pl-1"))
    }

    @Test
    fun `a remove never undoes a concurrent add`() = syncTest {
        seedPlaylist()
        a.transport.offline = true
        b.transport.offline = true
        a.engine.enqueue(
            SyncOpPayload.PlaylistItemRemove(playlistId = "pl-1", track = hashRef(2), editedAt = ts(40)),
        )
        b.engine.enqueue(
            SyncOpPayload.PlaylistItemAdd(playlistId = "pl-1", track = hashRef(4), editedAt = ts(41)),
        )
        a.engine.syncNow()
        b.engine.syncNow()
        a.transport.offline = false
        b.transport.offline = false
        a.engine.syncNow()
        b.engine.syncNow()

        assertThat(server.order("pl-1"))
            .containsExactly(idOf("hash-1"), idOf("hash-3"), idOf("hash-4"))
            .inOrder()
    }

    @Test
    fun `re-adding beats an older remove (LWW per item)`() = syncTest {
        seedPlaylist()
        a.engine.enqueue(
            SyncOpPayload.PlaylistItemRemove(playlistId = "pl-1", track = hashRef(2), editedAt = ts(40)),
        )
        b.engine.enqueue(
            SyncOpPayload.PlaylistItemAdd(playlistId = "pl-1", track = hashRef(2), editedAt = ts(45)),
        )
        b.engine.syncNow() // newer add lands first
        a.engine.syncNow() // older remove must lose
        assertThat(server.order("pl-1")).contains(idOf("hash-2"))
    }

    @Test
    fun `settings sync per key with LWW`() = syncTest {
        a.engine.enqueue(SyncOpPayload.SettingSet("global", "theme", str("light"), editedAt = ts(10)))
        b.engine.enqueue(SyncOpPayload.SettingSet("global", "theme", str("dark"), editedAt = ts(12)))
        b.engine.enqueue(SyncOpPayload.SettingSet("global", "accent", str("blue"), editedAt = ts(12)))
        b.engine.syncNow()
        a.engine.syncNow() // A's older theme loses; accent untouched

        assertThat(server.settings["global/theme"]?.value).isEqualTo(str("dark"))
        assertThat(server.settings["global/accent"]?.value).isEqualTo(str("blue"))
        val applied = a.changes.flatMap { it.settings }
        assertThat(applied.find { it.key == "theme" }?.value).isEqualTo(str("dark"))
    }

    @Test
    fun `queue handoff - LWW single row, identities mapped on pull`() = syncTest {
        a.engine.enqueue(
            SyncOpPayload.QueueSet(
                tracks = listOf(hashRef(1), hashRef(2)),
                currentIndex = 1,
                positionSeconds = 42.5,
                shuffle = false,
                repeat = "all",
                editedAt = ts(10),
            ),
        )
        a.engine.syncNow()

        b.engine.syncNow()
        val queue = b.changes.mapNotNull { it.queue }.firstOrNull()
        assertThat(queue).isNotNull()
        assertThat(queue!!.currentIndex).isEqualTo(1)
        assertThat(queue.positionSeconds).isEqualTo(42.5)
        assertThat(queue.repeat).isEqualTo("all")
        assertThat(queue.tracks.map { it.contentHash }).containsExactly("hash-1", "hash-2").inOrder()
        assertThat(queue.deviceId).isEqualTo("A")
    }

    @Test
    fun `play events are append-only and replay-idempotent`() = syncTest {
        val event = SyncOpPayload.PlayEventAdd(
            eventId = "evt-1",
            track = hashRef(1),
            playedAt = ts(10),
            durationPlayed = 175.0,
            completed = true,
        )
        a.engine.enqueue(event)
        a.engine.syncNow()
        // Crash-replay the same event id.
        a.storage.outboxPut(SyncOp(id = "A-op-replay", deviceId = "A", createdAt = ts(0), payload = event))
        a.engine.syncNow()

        assertThat(server.playEvents).hasSize(1)
        assertThat(server.playEvents["evt-1"]?.completed).isTrue()

        // B pulls the stream into its shadow.
        b.engine.syncNow()
        assertThat(b.changes.any { it.playEventsAdded == 1 }).isTrue()
    }

    @Test
    fun `distinct play events never coalesce`() = syncTest {
        for (i in 0 until 3) {
            a.engine.enqueue(
                SyncOpPayload.PlayEventAdd(
                    eventId = "evt-$i",
                    track = hashRef(1),
                    playedAt = ts(10 + i),
                    durationPlayed = 60.0,
                    completed = false,
                ),
            )
        }
        a.engine.syncNow()
        assertThat(server.playEvents).hasSize(3)
    }

    @Test
    fun `drops ops whose track ref has no durable identity`() = syncTest {
        a.engine.enqueue(
            SyncOpPayload.FavoriteSet(
                track = TrackRef(fileName = "no-identity.mp3"),
                favorite = true,
                editedAt = ts(10),
            ),
        )
        a.engine.syncNow()
        assertThat(server.tracks).isEmpty()
        assertThat(a.storage.outboxAll()).isEmpty()
    }

    // ---- track.edit (mirrors the "SyncEngine — track.edit" TS suite) ---------------

    private fun patch(json: String): JsonObject = SyncJson.parseToJsonElement(json).jsonObject

    private fun edit(track: TrackRef, json: String, editedAt: String) =
        SyncOpPayload.TrackEditOp(track, patch(json), editedAt)

    /** Publishes hashRef(n) via a first edit on A and lets B see it. */
    private suspend fun Harness.publish(n: Int): TrackRow {
        a.engine.enqueue(edit(hashRef(n), """{"genre": "Seed"}""", ts(1)))
        a.engine.syncNow()
        b.engine.syncNow()
        return server.tracks.values.first { it.contentHash == "hash-$n" }
    }

    private suspend fun Device.shadowTrack(id: String): TrackRow? =
        storage.shadowGet("tracks", id)?.let { SyncJson.decodeFromString(TrackRow.serializer(), it) }

    @Test
    fun `track edit flushes through apply_track_edit and reaches the other device`() = syncTest {
        val track = publish(1)
        a.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"title": "Renamed", "language": "Bangla"}""", ts(20)))
        a.engine.syncNow()

        assertThat(server.tracks[track.id]?.title).isEqualTo("Renamed")
        assertThat(a.storage.outboxAll()).isEmpty()
        assertThat(a.shadowTrack(track.id)?.language).isEqualTo("Bangla")

        b.changes.clear()
        b.engine.syncNow()
        assertThat(b.shadowTrack(track.id)?.title).isEqualTo("Renamed")
        assertThat(b.changes.any { it.tracksChanged }).isTrue()
    }

    @Test
    fun `offline edits to different fields on two devices both survive`() = syncTest {
        val track = publish(1)
        a.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"title": "From A"}""", ts(30)))
        b.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"genre": "From B"}""", ts(20)))
        a.engine.syncNow()
        b.engine.syncNow()
        a.engine.syncNow()

        val row = server.tracks.getValue(track.id)
        assertThat(row.title).isEqualTo("From A")
        assertThat(row.genre).isEqualTo("From B")
        assertThat(a.shadowTrack(track.id)?.genre).isEqualTo("From B")
        assertThat(b.shadowTrack(track.id)?.title).isEqualTo("From A")
    }

    @Test
    fun `the newer edit of a field wins whichever device flushes first`() = syncTest {
        val track = publish(1)
        a.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"title": "Newer"}""", ts(30)))
        b.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"title": "Older"}""", ts(20)))
        a.engine.syncNow()
        b.engine.syncNow() // B's older edit loses; B converges on the server row

        assertThat(server.tracks[track.id]?.title).isEqualTo("Newer")
        assertThat(b.shadowTrack(track.id)?.title).isEqualTo("Newer")
        assertThat(
            b.engine.getBreadcrumbs().any { it.event == "flush.conflictLost" && it.detail["fields"] == "title" },
        ).isTrue()
    }

    @Test
    fun `queued edits coalesce only when they touch the same fields`() = syncTest {
        val track = publish(1)
        a.transport.applyEditCalls = 0
        a.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"title": "One"}""", ts(10)))
        a.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"title": "Two"}""", ts(11)))
        a.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"genre": "Rock"}""", ts(12)))
        a.engine.syncNow()

        assertThat(a.transport.applyEditCalls).isEqualTo(2)
        assertThat(server.tracks[track.id]?.title).isEqualTo("Two")
        assertThat(server.tracks[track.id]?.genre).isEqualTo("Rock")
    }

    @Test
    fun `an edit to a track deleted elsewhere is dropped, not retried`() = syncTest {
        val track = publish(1)
        server.tracks[track.id] = server.tracks.getValue(track.id).copy(deletedAt = ts(5), updatedAt = server.tick())
        a.engine.enqueue(edit(TrackRef(remoteId = track.id), """{"title": "Too late"}""", ts(20)))
        a.engine.syncNow()

        assertThat(a.storage.outboxAll()).isEmpty()
        assertThat(server.tracks[track.id]?.title).isEqualTo("Song 1")
    }

    @Test
    fun `never queues read-only, unknown or empty patches`() = syncTest {
        a.engine.enqueue(edit(hashRef(1), """{"duration": 1}""", ts(10)))
        a.engine.enqueue(edit(hashRef(1), "{}", ts(11)))
        a.engine.enqueue(edit(hashRef(1), """{"title": "  "}""", ts(12)))
        assertThat(a.storage.outboxAll()).isEmpty()
        assertThat(a.engine.getBreadcrumbs().count { it.event == "enqueue.dropped" }).isEqualTo(3)
    }

    @Test
    fun `ops queued against a merged duplicate land on the surviving row`() = syncTest {
        val keep = publish(1)
        val drop = publish(2)
        // The server merged 2 into 1 (merge_tracks): 2 is now a tombstone.
        server.tracks[drop.id] = server.tracks.getValue(drop.id).copy(
            contentHash = null,
            deletedAt = ts(40),
            mergedInto = keep.id,
            updatedAt = server.tick(),
        )
        a.engine.syncNow() // learns about the merge

        a.engine.enqueue(SyncOpPayload.FavoriteSet(TrackRef(remoteId = drop.id), favorite = true, editedAt = ts(50)))
        a.engine.enqueue(edit(TrackRef(remoteId = drop.id), """{"title": "Merged"}""", ts(51)))
        a.engine.syncNow()

        assertThat(server.favorites[keep.id]?.favorite).isTrue()
        assertThat(server.favorites.containsKey(drop.id)).isFalse()
        assertThat(server.tracks[keep.id]?.title).isEqualTo("Merged")
    }

    @Test
    fun `a full pull drops shadow rows the server no longer has, an incremental pull keeps them`() = syncTest {
        val keep = publish(1)
        val gone = publish(2)
        server.tracks.remove(gone.id) // hard-deleted before tombstones existed

        b.engine.syncNow()
        assertThat(b.shadowTrack(gone.id)).isNotNull()

        b.changes.clear()
        b.engine.syncNow(fullPull = true)
        assertThat(b.shadowTrack(gone.id)).isNull()
        assertThat(b.shadowTrack(keep.id)).isNotNull()
        assertThat(b.changes.any { it.tracksChanged }).isTrue()

        // Its identity is forgotten too: a new op for that hash creates a fresh row.
        b.engine.enqueue(edit(hashRef(2), """{"genre": "Again"}""", ts(60)))
        b.engine.syncNow()
        assertThat(server.tracks.values.first { it.contentHash == "hash-2" }.id).isNotEqualTo(gone.id)
    }
}
