import { create } from "zustand";
import { dedupeEvents, type PlayEventRow, type StatsEvent, type StatsTrackMeta, type TrackRow } from "@musicvault/core";
import { playEventsAll, syncShadowAll } from "../lib/ipc";
import { useLibraryStore } from "./libraryStore";

/**
 * Statistics source (Phase 7): merges the device's local play-event log
 * (SQLite play_events — works signed out, survives sign-out) with the synced
 * play_events shadow (every device's events, pulled from Supabase). The two
 * overlap for events this device recorded while signed in; they share the
 * same event id, so dedupe keeps exactly one copy.
 *
 * Shadow events reference remote track UUIDs. Where the remote track maps
 * into the library (remote id / content hash) the event is
 * re-keyed to the local track id so both sources aggregate together; where it
 * doesn't, the remote id is kept and metadata comes from the shadowed row.
 */

interface StatsState {
  events: StatsEvent[];
  metaById: Map<string, StatsTrackMeta>;
  loaded: boolean;
  load: () => Promise<void>;
  /** Live append from the audio engine so an open stats view stays current. */
  appendLocal: (event: StatsEvent) => void;
}

let loadInFlight: Promise<void> | null = null;

export const useStatsStore = create<StatsState>((set, get) => ({
  events: [],
  metaById: new Map(),
  loaded: false,

  load: async () => {
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      try {
        const [localRows, shadowEventRows, shadowTrackRows] = await Promise.all([
          playEventsAll(),
          syncShadowAll("play_events").catch(() => []),
          syncShadowAll("tracks").catch(() => []),
        ]);

        const localEvents: StatsEvent[] = localRows.map((row) => ({
          id: row.id,
          trackId: row.trackId,
          playedAt: row.playedAt,
          durationPlayed: row.durationPlayed,
          completed: row.completed,
        }));

        const remoteTracks = new Map<string, TrackRow>();
        for (const { id, payload } of shadowTrackRows) {
          remoteTracks.set(id, JSON.parse(payload) as TrackRow);
        }

        const metaById = new Map<string, StatsTrackMeta>();
        const libraryTracks = useLibraryStore.getState().tracks;
        for (const track of libraryTracks) {
          metaById.set(track.id, {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            genre: track.genre ?? null,
          });
        }

        // Remote track UUID → id used for aggregation (local when mappable).
        const find = useLibraryStore.getState().findTrackByIdentity;
        const aggregateId = new Map<string, string>();
        for (const [remoteId, row] of remoteTracks) {
          const local = find({ remoteId, contentHash: row.content_hash });
          if (local) {
            aggregateId.set(remoteId, local.id);
          } else {
            aggregateId.set(remoteId, remoteId);
            metaById.set(remoteId, {
              id: remoteId,
              title: row.title,
              artist: row.artist,
              album: row.album,
              genre: row.genre,
            });
          }
        }

        const shadowEvents: StatsEvent[] = shadowEventRows.map(({ payload }) => {
          const row = JSON.parse(payload) as PlayEventRow;
          return {
            id: row.id,
            trackId: aggregateId.get(row.track_id) ?? row.track_id,
            playedAt: Date.parse(row.played_at),
            durationPlayed: row.duration_played,
            completed: row.completed,
          };
        });

        // Local first: this device's copy of an event wins the dedupe.
        set({ events: dedupeEvents(localEvents, shadowEvents), metaById, loaded: true });
      } catch (err) {
        console.error("[stats] load failed:", err);
      } finally {
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  },

  appendLocal: (event) => {
    if (!get().loaded) return;
    set((state) => ({ events: [...state.events, event] }));
  },
}));

/** Called by the sync store after a pull that added play events. */
export function refreshStatsIfLoaded(): void {
  if (useStatsStore.getState().loaded) void useStatsStore.getState().load();
}
