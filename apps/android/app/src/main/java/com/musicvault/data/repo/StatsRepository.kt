package com.musicvault.data.repo

import com.musicvault.data.db.PlayEventDao
import com.musicvault.data.db.PlayEventEntity
import com.musicvault.data.db.SyncDao
import com.musicvault.data.sync.PlayEventRow
import com.musicvault.data.sync.SyncBus
import com.musicvault.data.sync.SyncOpPayload
import com.musicvault.data.sync.TrackRow
import com.musicvault.domain.Stats
import com.musicvault.domain.StatsEvent
import com.musicvault.domain.StatsTrackMeta
import com.musicvault.domain.model.Track
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.time.Instant
import java.time.OffsetDateTime
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Statistics source (Phase 7): merges the device's local play-event log
 * (Room play_events — works signed out, survives sign-out) with the synced
 * play_events shadow (every device's events, pulled from Supabase). The two
 * overlap for events this device recorded while signed in; they share the
 * same event id, so dedupe keeps exactly one copy.
 *
 * Shadow events reference remote track UUIDs. Where the remote track maps
 * into the library (remote id / content hash) the event is
 * re-keyed to the local track id so both sources aggregate together; where
 * it doesn't, the remote id is kept and metadata comes from the shadowed row.
 */
@Singleton
class StatsRepository @Inject constructor(
    private val playEventDao: PlayEventDao,
    syncDao: SyncDao,
    libraryRepository: LibraryRepository,
) {
    data class StatsData(
        val events: List<StatsEvent> = emptyList(),
        val metaById: Map<String, StatsTrackMeta> = emptyMap(),
        val loaded: Boolean = false,
    )

    private val json = Json { ignoreUnknownKeys = true }

    val data: Flow<StatsData> = combine(
        playEventDao.observeAll(),
        syncDao.observeShadow("play_events"),
        syncDao.observeShadow("tracks"),
        libraryRepository.tracks,
    ) { localRows, shadowEventRows, shadowTrackRows, tracks ->
        val localEvents = localRows.map {
            StatsEvent(it.id, it.trackId, it.playedAt, it.durationPlayed, it.completed)
        }

        val metaById = HashMap<String, StatsTrackMeta>()
        for (track in tracks) {
            metaById[track.id] = StatsTrackMeta(track.id, track.title, track.artist, track.album, track.genre)
        }

        // Remote track UUID → id used for aggregation (local when mappable).
        val byRemote = tracks.filter { it.remoteId != null }.associateBy { it.remoteId }
        val byHash = tracks.filter { it.contentHash != null }.associateBy { it.contentHash }
        val aggregateId = HashMap<String, String>()
        for (shadow in shadowTrackRows) {
            val row = runCatching { json.decodeFromString(TrackRow.serializer(), shadow.payload) }.getOrNull() ?: continue
            val local = byRemote[row.id] ?: row.contentHash?.let { byHash[it] }
            if (local != null) {
                aggregateId[row.id] = local.id
            } else {
                aggregateId[row.id] = row.id
                metaById[row.id] = StatsTrackMeta(row.id, row.title, row.artist, row.album, row.genre)
            }
        }

        val shadowEvents = shadowEventRows.mapNotNull { shadow ->
            val row = runCatching { json.decodeFromString(PlayEventRow.serializer(), shadow.payload) }.getOrNull()
                ?: return@mapNotNull null
            StatsEvent(
                id = row.id,
                trackId = aggregateId[row.trackId] ?: row.trackId,
                playedAt = parseIsoMs(row.playedAt),
                durationPlayed = row.durationPlayed,
                completed = row.completed,
            )
        }

        // Local first: this device's copy of an event wins the dedupe.
        StatsData(Stats.dedupeEvents(localEvents, shadowEvents), metaById, loaded = true)
    }

    /**
     * Closes out one listening session: the full event always lands in the
     * local log; tracks with sync identity also enqueue playEvent.add under
     * the SAME event id so the copy pulled back into the shadow dedupes.
     */
    suspend fun recordSession(track: Track, startedAtMs: Long, seconds: Long) {
        if (seconds < 1) return
        val durationSec = track.durationMs / 1000.0
        val completed = durationSec > 0 && seconds >= durationSec * 0.9
        val eventId = UUID.randomUUID().toString()
        try {
            playEventDao.add(PlayEventEntity(eventId, track.id, startedAtMs, seconds.toDouble(), completed))
        } catch (e: Exception) {
            Timber.e(e, "Failed to record play event")
        }
        SyncBus.refFromTrack(track)?.let { ref ->
            SyncBus.enqueue(
                SyncOpPayload.PlayEventAdd(
                    eventId = eventId,
                    track = ref,
                    playedAt = Instant.ofEpochMilli(startedAtMs).toString(),
                    durationPlayed = seconds.toDouble(),
                    completed = completed,
                )
            )
        }
    }

    private fun parseIsoMs(iso: String): Long =
        runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(iso).toEpochMilli() }
            .getOrDefault(0L)
}
