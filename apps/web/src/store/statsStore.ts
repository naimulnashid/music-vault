import { create } from "zustand";
import { dedupeEvents, type PlayEventRow, type StatsEvent, type StatsTrackMeta } from "@musicvault/core";
import { allPlayEvents } from "../lib/playEventLog";
import { IdbSyncStorage } from "../lib/syncStorage";
import { useLibraryStore } from "./libraryStore";
import { useAuthStore } from "./authStore";
import { getSupabaseBrowser } from "../lib/supabase/browser";

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

export interface StatsDevice {
  name: string;
  platform: string;
}

interface StatsState {
  events: StatsEvent[];
  metaById: Map<string, StatsTrackMeta>;
  /** The account's devices by id, for "Play time by device"; empty when signed out or offline. */
  devices: Map<string, StatsDevice>;
  loaded: boolean;
  load: () => Promise<void>;
  /** Live append from the audio engine so an open stats view stays current. */
  appendLocal: (event: StatsEvent) => void;
}

let loadInFlight: Promise<void> | null = null;

/** id, name and platform only: the devices table is small and holds nothing else worth reading. */
async function loadDevices(): Promise<Map<string, StatsDevice> | null> {
  const client = getSupabaseBrowser();
  if (!client || !useAuthStore.getState().session) return null;
  const { data, error } = await client.from("devices").select("id, name, platform");
  if (error || !data) return null;
  return new Map(data.map((d) => [d.id, { name: d.name, platform: d.platform }]));
}

export const useStatsStore = create<StatsState>((set, get) => ({
  events: [],
  metaById: new Map(),
  devices: new Map(),
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
            deviceId: row.device_id,
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
            year: track.year ?? null,
            language: track.language ?? null,
            country: track.country ?? null,
          });
        }

        // The local log doesn't record the device: it is this one, or what
        // the synced copy says when the event was recorded under another sign-in.
        const shadowDevice = new Map(shadowEvents.map((e) => [e.id, e.deviceId ?? null]));
        const thisDevice = useAuthStore.getState().deviceId;
        const localWithDevice = localEvents.map((e) => ({ ...e, deviceId: shadowDevice.get(e.id) ?? e.deviceId ?? thisDevice }));

        // Local first: this device's copy of an event wins the dedupe.
        set({ events: dedupeEvents(localWithDevice, shadowEvents), metaById, loaded: true });
        void loadDevices().then((devices) => devices && set({ devices }));
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
  useStatsStore.setState({ events: [], metaById: new Map(), devices: new Map(), loaded: false });
}

export function refreshStatsIfLoaded(): void {
  if (useStatsStore.getState().loaded) void useStatsStore.getState().load();
}
