import { create } from "zustand";
import { dedupeEvents, type PlayEventRow, type StatsEvent, type StatsTrackMeta } from "@musicvault/core";
import { allPlayEvents } from "../lib/playEventLog";
import { IdbSyncStorage } from "../lib/syncStorage";
import { useLibraryStore } from "./libraryStore";

/**
 * Statistics source (Phase 7): merges the browser's local play-event log
 * (IndexedDB "mv-stats" — survives sign-out) with the synced play_events
 * shadow (every device's events). Overlapping copies share the same event
 * id, so dedupe keeps exactly one.
 *
 * The web library is hydrated from the sync shadow, so shadow events'
 * track_id (the remote UUID) already matches the library track id — no
 * identity re-keying needed, unlike desktop.
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
        const storage = new IdbSyncStorage();
        const [localEvents, shadowEventRows] = await Promise.all([
          allPlayEvents(),
          storage.shadowAll("play_events").catch(() => []),
        ]);

        const shadowEvents: StatsEvent[] = shadowEventRows.map(({ payload }) => {
          const row = JSON.parse(payload) as PlayEventRow;
          return {
            id: row.id,
            trackId: row.track_id,
            playedAt: Date.parse(row.played_at),
            durationPlayed: row.duration_played,
            completed: row.completed,
          };
        });

        const metaById = new Map<string, StatsTrackMeta>();
        for (const track of useLibraryStore.getState().tracks) {
          metaById.set(track.id, {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            genre: track.genre ?? null,
          });
        }

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
/** Sign-out: drop the previous account's events; the next open reloads from what this device keeps. */
export function resetStats(): void {
  useStatsStore.setState({ events: [], metaById: new Map(), loaded: false });
}

export function refreshStatsIfLoaded(): void {
  if (useStatsStore.getState().loaded) void useStatsStore.getState().load();
}
