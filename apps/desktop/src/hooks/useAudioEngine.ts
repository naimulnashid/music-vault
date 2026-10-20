import { useEffect, useRef } from "react";
import type { ReplayGainMode, Track } from "../types";
import { player } from "../lib/player";
import { onAdvanced, onEnded, onPlayerError, onPlayerState, onPosition, playEventAdd } from "../lib/ipc";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import { useHistoryStore } from "../store/historyStore";
import { useSleepStore } from "../store/sleepStore";
import { useStatsStore } from "../store/statsStore";
import { saveLastPlayback } from "../lib/lastPlayback";
import { resolveVaultTrack } from "../lib/vault";
import { refFromTrack, syncEnqueue, syncEnqueueFor } from "../lib/syncBus";
import { useAuthStore } from "../store/authStore";
import { clearCheckpoint, countsAsPlay, isCompleted, newPlaySession, saveCheckpoint, takeCheckpoint, type PlaySession } from "../lib/playSession";

/**
 * Writes a finished session as a play event: the full event to the local log
 * and, when the track has sync identity, to the cloud stream under the SAME
 * event id, so the copy pulled back dedupes against the local row. Recording a
 * session twice is harmless: both stores keep the first row for an id.
 */
const currentUserId = (): string | null => useAuthStore.getState().session?.user.id ?? null;

function recordSession(session: PlaySession, recovered = false): void {
  if (!countsAsPlay(session)) return;
  const completed = isCompleted(session);
  const event = {
    id: session.eventId,
    trackId: session.trackId,
    playedAt: session.startedAtMs,
    durationPlayed: session.seconds,
    completed,
  };
  void playEventAdd(event);
  useStatsStore.getState().appendLocal(event);
  if (!session.ref || !session.userId) return;
  const op = {
    kind: "playEvent.add" as const,
    eventId: session.eventId,
    track: session.ref,
    playedAt: new Date(session.startedAtMs).toISOString(),
    durationPlayed: session.seconds,
    completed,
  };
  // A recovered session may predate this run's sync engine, so it waits for
  // its own account's engine instead of being dropped.
  if (recovered) syncEnqueueFor(session.userId, op);
  else syncEnqueue(op);
}


const PRELOAD_LEAD_SECONDS = 15;

/**
 * ReplayGain dB for a track under the active mode; falls back to the other
 * gain when the preferred one wasn't tagged. null = no adjustment.
 */
function rgDbFor(track: Track | null, mode: ReplayGainMode): number | null {
  if (!track || mode === "off") return null;
  const preferred = mode === "album" ? track.replayGainAlbum : track.replayGainTrack;
  return preferred ?? (mode === "album" ? track.replayGainTrack : track.replayGainAlbum) ?? null;
}

/**
 * Bridges the native Rust audio engine to the React stores.
 *
 * The engine owns all transition mechanics (gapless splice, crossfade ramps);
 * this hook keeps the *policy*: it decides which track comes next, arms the
 * engine's preload ~15s before the end, and maps the engine's "advanced"
 * event back onto the queue.
 */
export function useAudioEngine() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const volume = useSettingsStore((s) => s.volume);
  const eqBands = useSettingsStore((s) => s.eqBands);
  const gapless = useSettingsStore((s) => s.gapless);
  const crossfadeDuration = useSettingsStore((s) => s.crossfadeDuration);

  // Id of the track currently loaded in the engine. When an auto transition
  // (crossfade/gapless) advances the queue, we set this ahead of time so the
  // load effect below recognises the track is already playing and skips
  // reloading it (which would restart audio and kill the transition).
  const loadedTrackId = useRef<string | null>(null);
  const preloadedId = useRef<string | null>(null);
  const playSession = useRef<PlaySession | null>(null);
  /** Ends the running listening session (if any) and records it. */
  const finishSession = () => {
    const session = playSession.current;
    playSession.current = null;
    clearCheckpoint();
    if (session) recordSession(session);
  };

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let disposed = false;

    const register = (p: Promise<() => void>) => {
      void p.then((un) => {
        if (disposed) un();
        else unlistens.push(un);
      });
    };

    register(
      onPosition(({ position, duration }) => {
        const playerStore = usePlayerStore.getState();
        // The engine keeps reporting the old song (e.g. its final position)
        // until the next one is loaded — often while that one is still
        // downloading. Don't let those ticks leak into the new song.
        if (!playerStore.currentTrack || loadedTrackId.current !== playerStore.currentTrack.id) return;
        playerStore.setCurrentTime(position);
        // Some containers (VBR mp3 without a Xing header) don't expose a
        // decode-side duration; keep the tag-derived one in that case.
        const effective = duration > 0 ? duration : playerStore.currentTrack?.duration ?? 0;
        if (effective > 0 && effective !== playerStore.duration) playerStore.setDuration(effective);

        // Preload policy: arm the engine with the next track shortly before
        // the current one ends so gapless/crossfade can splice seamlessly.
        const settings = useSettingsStore.getState();
        const { currentTrack: track, queue } = playerStore;
        if (!track || !duration) return;
        const nextIndex = playerStore.getNextIndex();
        if (nextIndex === null) return;
        const nextTrack = queue[nextIndex];
        if (!nextTrack) return;

        const remaining = duration - position;
        const wantSeamless = settings.gapless || settings.crossfadeDuration > 0;
        if (wantSeamless && remaining < PRELOAD_LEAD_SECONDS && preloadedId.current !== nextTrack.id) {
          if (!nextTrack.path) {
            // Not on this device yet: start its download now; once the resolver
            // fills in the path a later tick arms the engine with it.
            resolveVaultTrack(nextTrack, { preload: true });
            return;
          }
          player.preloadNext(nextTrack.path, rgDbFor(nextTrack, settings.replayGainMode ?? "off"));
          preloadedId.current = nextTrack.id;
        }
      }),
    );

    register(
      onPlayerState(({ playing }) => {
        usePlayerStore.getState().setIsPlaying(playing);
      }),
    );

    // The engine spliced into the preloaded track (gapless or crossfade
    // start). Move the queue pointer without reloading the engine.
    register(
      onAdvanced(({ path }) => {
        const playerStore = usePlayerStore.getState();
        const nextIndex = playerStore.getNextIndex();
        if (nextIndex === null) return;
        const nextTrack = playerStore.queue[nextIndex];
        if (!nextTrack || nextTrack.path !== path) return;
        loadedTrackId.current = nextTrack.id;
        preloadedId.current = null;
        playerStore.jumpTo(nextIndex);
      }),
    );

    // Track finished with nothing preloaded (transitions off, repeat-one, or
    // end of queue) — the queue decides what happens next.
    register(
      onEnded(() => {
        const playerStore = usePlayerStore.getState();
        // Only the song that is actually loaded can end; a stray "ended" after
        // we've already moved on must not skip another song.
        if (!playerStore.currentTrack || loadedTrackId.current !== playerStore.currentTrack.id) return;
        preloadedId.current = null;
        finishSession();
        playerStore.next();
      }),
    );

    register(
      onPlayerError(({ message, path }) => {
        console.error("[player] engine error:", message, path ?? "");
        const playerStore = usePlayerStore.getState();
        // Skip past an unplayable current track so the queue doesn't stall.
        if (path && playerStore.currentTrack?.path === path && playerStore.queue.length > 1) {
          playerStore.next();
        } else {
          playerStore.setIsPlaying(false);
        }
      }),
    );

    return () => {
      disposed = true;
      unlistens.forEach((un) => un());
    };
  }, []);

  // Load on manual track change (initial play, clicking a track, next/prev).
  useEffect(() => {
    if (!currentTrack) return;
    if (loadedTrackId.current === currentTrack.id) return;
    // Not on this device yet: kick off download-then-play. The resolver writes
    // the cached path back into the queue, which re-runs this effect with a path.
    if (!currentTrack.path) {
      preloadedId.current = null;
      resolveVaultTrack(currentTrack);
      return;
    }
    loadedTrackId.current = currentTrack.id;
    // A manual change invalidates any pending auto-transition bookkeeping.
    preloadedId.current = null;
    const state = usePlayerStore.getState();
    // A saved position only applies to a restored (paused) session; a song
    // the user or the queue just switched to always starts at the top.
    const startAt = !state.isPlaying && state.currentTime > 0 ? state.currentTime : 0;
    if (startAt === 0 && state.currentTime !== 0) state.setCurrentTime(0);
    player.loadTrack(
      currentTrack.path,
      startAt,
      state.isPlaying,
      rgDbFor(currentTrack, useSettingsStore.getState().replayGainMode ?? "off"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack]);

  // ReplayGain mode changed: retune the already-playing track live. This also
  // covers auto-advanced tracks (gapless/crossfade), whose gain was set at
  // preload time with the then-current mode.
  const replayGainMode = useSettingsStore((s) => s.replayGainMode ?? "off");
  useEffect(() => {
    if (!currentTrack) return;
    player.setReplayGain(rgDbFor(currentTrack, replayGainMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayGainMode]);

  // A session left over from a crash or a closed window: record it now.
  useEffect(() => {
    const leftover = takeCheckpoint();
    if (leftover) recordSession(leftover, true);
    // Closing the page or window ends the session; the checkpoint covers it
    // if the write doesn't finish in time.
    window.addEventListener("pagehide", finishSession);
    return () => window.removeEventListener("pagehide", finishSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new current track ends the previous track's session and starts its own.
  useEffect(() => {
    finishSession();
    if (currentTrack) {
      useHistoryStore.getState().recordPlay(currentTrack.id);
      playSession.current = newPlaySession(currentTrack, refFromTrack(currentTrack), currentUserId());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!currentTrack) return;
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    player.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    player.setEqBands(eqBands);
  }, [eqBands]);

  useEffect(() => {
    player.setGapless(gapless);
  }, [gapless]);

  useEffect(() => {
    player.setCrossfade(crossfadeDuration);
  }, [crossfadeDuration]);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = useSleepStore.getState().tick();
      if (elapsed) {
        player.pause();
        usePlayerStore.getState().setIsPlaying(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Track cumulative listening time and persist the resume position once per
  // second while a track is actively playing.
  useEffect(() => {
    const interval = setInterval(() => {
      const playerStore = usePlayerStore.getState();
      if (!playerStore.isPlaying || !playerStore.currentTrack) return;
      useHistoryStore.getState().addListenSeconds(playerStore.currentTrack.id, 1);
      // The song ended (repeat-one, or replayed at the end of the queue) and is
      // playing again: that is a new play.
      if (!playSession.current) {
        useHistoryStore.getState().recordPlay(playerStore.currentTrack.id);
        playSession.current = newPlaySession(playerStore.currentTrack, refFromTrack(playerStore.currentTrack), currentUserId());
      }
      playSession.current.seconds += 1;
      saveCheckpoint(playSession.current);
      saveLastPlayback(playerStore.currentTrack.id, playerStore.currentTime);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Also persist immediately on pause so a resume right after pausing is accurate.
  useEffect(() => {
    if (isPlaying || !currentTrack) return;
    saveLastPlayback(currentTrack.id, usePlayerStore.getState().currentTime);
  }, [isPlaying, currentTrack]);
}

export function seekAudio(time: number) {
  player.seek(time);
  usePlayerStore.getState().seekTo(time);
}
