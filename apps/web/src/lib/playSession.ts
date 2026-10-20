import type { TrackRef } from "@musicvault/core";

/**
 * One listening session of one track, for the play-event stream. The event id
 * is fixed when the session starts, so recording it twice (on close, then again
 * from the checkpoint at the next start) still yields one event.
 */
export interface PlaySession {
  eventId: string;
  trackId: string;
  /** Sync identity; null for identity-less local files (local log only). */
  ref: TrackRef | null;
  /** The account signed in when it started; its cloud copy goes only to that account. */
  userId: string | null;
  duration: number;
  startedAtMs: number;
  seconds: number;
}

const CHECKPOINT_KEY = "mv.playSession";

export function newPlaySession(
  track: { id: string; duration: number },
  ref: TrackRef | null,
  userId: string | null,
): PlaySession {
  return { eventId: crypto.randomUUID(), trackId: track.id, ref, userId, duration: track.duration, startedAtMs: Date.now(), seconds: 0 };
}

/** A session long enough to count; shorter ones (a skip) leave no event. */
export function countsAsPlay(session: PlaySession): boolean {
  return session.seconds >= 1;
}

export function isCompleted(session: PlaySession): boolean {
  return session.duration > 0 && session.seconds >= session.duration * 0.9;
}

// The checkpoint is what survives a crash or a closed window: the session as of
// the last second played, recorded at the next start.
export function saveCheckpoint(session: PlaySession): void {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(session));
  } catch {
    // Storage full or blocked: the session is still recorded when it ends normally.
  }
}

export function clearCheckpoint(): void {
  try {
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch {
    // nothing to clear
  }
}

export function takeCheckpoint(): PlaySession | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    localStorage.removeItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<PlaySession>;
    if (typeof s.eventId !== "string" || typeof s.trackId !== "string" || typeof s.seconds !== "number") return null;
    return {
      eventId: s.eventId,
      trackId: s.trackId,
      ref: s.ref ?? null,
      userId: typeof s.userId === "string" ? s.userId : null,
      duration: typeof s.duration === "number" ? s.duration : 0,
      startedAtMs: typeof s.startedAtMs === "number" ? s.startedAtMs : Date.now(),
      seconds: s.seconds,
    };
  } catch {
    return null;
  }
}
