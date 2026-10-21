import { useEffect, useRef } from "react";
import { audioEngine } from "../lib/audioEngine";
import { resolveTrackAudio } from "../lib/audioCache";
import { emitAppError } from "../lib/errorBus";
import { isOfflineError, playbackErrorMessage } from "../lib/playbackError";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import { useHistoryStore } from "../store/historyStore";
import { useSleepStore } from "../store/sleepStore";
import { useDownloadStore } from "../store/downloadStore";
import { useStatsStore } from "../store/statsStore";
import { saveLastPlayback } from "../lib/lastPlayback";
import { addPlayEvent } from "../lib/playEventLog";
import { refFromTrack, syncEnqueue, syncEnqueueFor } from "../lib/syncBus";
import { useAuthStore } from "../store/authStore";
import { clearCheckpoint, countsAsPlay, isCompleted, newPlaySession, saveCheckpoint, takeCheckpoint, type PlaySession } from "../lib/playSession";
import type { Track } from "../types";

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
  void addPlayEvent(event);
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
 * Bridges the Web Audio engine to the React stores.
 *
 * Web tracks have no local file: audio bytes resolve through the two-tier
 * OPFS cache (hit → instant; miss → download-then-play from the vault). The
 * engine still owns transition mechanics (gapless splice, crossfade ramps);
 * this hook keeps the policy, as on desktop.
 */
export function useAudioEngine() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const volume = useSettingsStore((s) => s.volume);
  const eqBands = useSettingsStore((s) => s.eqBands);

  // Id of the track currently loaded into the active element. When an auto
  // transition (crossfade/gapless) advances the queue, we set this ahead of
  // time so the load effect below recognises the track is already playing and
  // skips reloading it (which would restart audio and kill the transition).
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
  const preloadingId = useRef<string | null>(null);
  const transitionFor = useRef<string | null>(null);
  // While a crossfade ramp is running, the outgoing track is still audible on
  // the now-inactive element. Preloading would overwrite its src and cut the
  // fade-out short, so hold off preloading until the ramp finishes.
  const transitionEndsAt = useRef<number>(0);
  /** Monotonic guard against stale async resolutions racing a track change. */
  const loadGeneration = useRef(0);

  useEffect(() => {
    const resolveFor = async (track: Track): Promise<Blob | null> => {
      try {
        return await resolveTrackAudio(
          track,
          (p) => useDownloadStore.getState().reportProgress(track.id, p),
          useDownloadStore.getState().autoDownload ? "pin" : "cache",
        );
      } catch (err) {
        // A preload: offline, the message waits until the song is actually played.
        if (!isOfflineError(err)) emitAppError(playbackErrorMessage(track.title, err));
        return null;
      } finally {
        useDownloadStore.getState().reportProgress(track.id, null);
      }
    };

    const preload = async (track: Track) => {
      if (preloadingId.current === track.id || preloadedId.current === track.id) return;
      preloadingId.current = track.id;
      const blob = await resolveFor(track);
      if (preloadingId.current !== track.id) return; // superseded
      preloadingId.current = null;
      if (!blob) return;
      // Still the upcoming track? (queue may have changed while downloading)
      const player = usePlayerStore.getState();
      const nextIndex = player.getNextIndex();
      if (nextIndex === null || player.queue[nextIndex]?.id !== track.id) return;
      audioEngine.preloadNext(blob);
      preloadedId.current = track.id;
    };

    const handleTick = (time: number) => {
      const player = usePlayerStore.getState();
      const settings = useSettingsStore.getState();
      const { currentTrack: track, duration, queue } = player;
      if (!track || !duration) return;

      const nextIndex = player.getNextIndex();
      if (nextIndex === null) return;
      const nextTrack = queue[nextIndex];
      if (!nextTrack) return;

      const remaining = duration - time;
      const wantSeamless = settings.gapless || settings.crossfadeDuration > 0;
      const rampDone = Date.now() >= transitionEndsAt.current;

      if (wantSeamless && rampDone && remaining < PRELOAD_LEAD_SECONDS && preloadedId.current !== nextTrack.id) {
        void preload(nextTrack);
      }

      const xf = settings.crossfadeDuration;
      if (
        xf > 0 &&
        remaining <= xf &&
        remaining > 0.15 &&
        transitionFor.current !== track.id &&
        preloadedId.current === nextTrack.id
      ) {
        transitionFor.current = track.id;
        const dur = Math.min(xf, remaining);
        transitionEndsAt.current = Date.now() + dur * 1000 + 200;
        loadedTrackId.current = nextTrack.id;
        void audioEngine.crossfadeToNext(dur);
        player.jumpTo(nextIndex);
      }
    };

    const handleEnded = () => {
      const player = usePlayerStore.getState();
      // Only the song that is actually loaded can end; a stray "ended" after
      // we've already moved on must not skip another song.
      if (!player.currentTrack || loadedTrackId.current !== player.currentTrack.id) return;
      finishSession();
      const settings = useSettingsStore.getState();
      const { queue } = player;
      const nextIndex = player.getNextIndex();

      if (
        settings.gapless &&
        nextIndex !== null &&
        queue[nextIndex] &&
        preloadedId.current === queue[nextIndex].id
      ) {
        loadedTrackId.current = queue[nextIndex].id;
        void audioEngine.hardSwitchToPreloaded();
        player.jumpTo(nextIndex);
      } else {
        player.next();
      }
    };

    audioEngine.setCallbacks({
      onTime: (t) => {
        const player = usePlayerStore.getState();
        // The old song keeps ticking until the next one is loaded (often
        // while it downloads); don't let that leak into the new song.
        if (!player.currentTrack || loadedTrackId.current !== player.currentTrack.id) return;
        player.setCurrentTime(t);
        handleTick(t);
      },
      onDuration: (d) => {
        const player = usePlayerStore.getState();
        // Some containers don't expose a decode-side duration; keep the
        // tag-derived one in that case.
        const effective = d > 0 ? d : (player.currentTrack?.duration ?? 0);
        if (effective > 0 && effective !== player.duration) player.setDuration(effective);
      },
      onEnded: handleEnded,
      onPlaying: (p) => usePlayerStore.getState().setIsPlaying(p),
    });

    return () => audioEngine.setCallbacks({});
  }, []);

  // Load on manual track change (initial play, clicking a track, next/prev).
  useEffect(() => {
    if (!currentTrack) return;
    if (loadedTrackId.current === currentTrack.id) return;
    const generation = ++loadGeneration.current;
    // A manual change invalidates any pending auto-transition bookkeeping.
    transitionFor.current = null;
    preloadedId.current = null;
    preloadingId.current = null;
    transitionEndsAt.current = 0;

    const player = usePlayerStore.getState();
    player.setResolvingId(currentTrack.id);
    void (async () => {
      let blob: Blob | null = null;
      try {
        blob = await resolveTrackAudio(
          currentTrack,
          (p) => useDownloadStore.getState().reportProgress(currentTrack.id, p),
          useDownloadStore.getState().autoDownload ? "pin" : "cache",
        );
      } catch (err) {
        emitAppError(playbackErrorMessage(currentTrack.title, err));
      } finally {
        useDownloadStore.getState().reportProgress(currentTrack.id, null);
      }
      if (generation !== loadGeneration.current) return; // user moved on
      const state = usePlayerStore.getState();
      state.setResolvingId(null);
      if (!blob) {
        // Skip past an unplayable track so the queue doesn't stall.
        if (state.queue.length > 1 && state.isPlaying) state.next();
        else state.setIsPlaying(false);
        return;
      }
      loadedTrackId.current = currentTrack.id;
      audioEngine.loadTrack(blob);
      // A saved position only applies to a restored (paused) session; a song
      // just switched to always starts at the top.
      const resumeTime = state.isPlaying ? 0 : state.currentTime;
      if (resumeTime > 0) audioEngine.seek(resumeTime);
      else if (state.currentTime !== 0) state.setCurrentTime(0);
      if (state.isPlaying) void audioEngine.play();
      void useDownloadStore.getState().refreshDownloads();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack]);

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
    if (loadedTrackId.current !== currentTrack.id) return; // still resolving
    if (isPlaying) void audioEngine.play();
    else audioEngine.pause();
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    audioEngine.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    audioEngine.setEqBands(eqBands);
  }, [eqBands]);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = useSleepStore.getState().tick();
      if (elapsed) {
        audioEngine.pause();
        usePlayerStore.getState().setIsPlaying(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Track cumulative listening time and persist the resume position once per
  // second while a track is actively playing.
  useEffect(() => {
    const interval = setInterval(() => {
      const player = usePlayerStore.getState();
      if (!player.isPlaying || !player.currentTrack) return;
      useHistoryStore.getState().addListenSeconds(player.currentTrack.id, 1);
      // The song ended (repeat-one, or replayed at the end of the queue) and is
      // playing again: that is a new play.
      if (!playSession.current) {
        useHistoryStore.getState().recordPlay(player.currentTrack.id);
        playSession.current = newPlaySession(player.currentTrack, refFromTrack(player.currentTrack), currentUserId());
      }
      playSession.current.seconds += 1;
      saveCheckpoint(playSession.current);
      saveLastPlayback(player.currentTrack.id, player.currentTime, true);
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
  audioEngine.seek(time);
  usePlayerStore.getState().seekTo(time);
}
