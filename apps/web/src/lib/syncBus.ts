import { trackRefHasIdentity, type SyncOpPayload, type TrackRef } from "@musicvault/core";
import type { Track } from "../types";

/**
 * Decouples the data stores from the sync engine: stores call
 * {@link syncEnqueue} on every user mutation; the sync store installs the
 * real enqueue when a signed-in engine is running.
 */

let enqueueFn: ((payload: SyncOpPayload) => void) | null = null;
let enqueueUserId: string | null = null;
/** Ops that must reach one account's stream once its engine runs (see syncEnqueueFor). */
let waiting: Array<{ userId: string; payload: SyncOpPayload }> = [];

export function setSyncEnqueue(fn: ((payload: SyncOpPayload) => void) | null, userId: string | null = null): void {
  enqueueFn = fn;
  enqueueUserId = fn ? userId : null;
  if (!fn || !userId) return;
  // A different account signing in drops the waiting ops: they were not its own.
  const ready = waiting.filter((w) => w.userId === userId);
  waiting = [];
  ready.forEach((w) => fn(w.payload));
}

export function syncEnqueue(payload: SyncOpPayload): void {
  enqueueFn?.(payload);
}

/**
 * Enqueues for one account: now if its engine is running, else as soon as it
 * starts. Used for a play session recovered at startup, before sync is up.
 */
export function syncEnqueueFor(userId: string, payload: SyncOpPayload): void {
  if (enqueueFn && enqueueUserId === userId) enqueueFn(payload);
  else if (!enqueueFn) waiting.push({ userId, payload });
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Builds the sync TrackRef for a track. Every web track is a synced row, so
 * its id is the canonical remote id.
 */
export function refFromTrack(track: Track): TrackRef | null {
  const ref: TrackRef = {
    remoteId: track.id,
    contentHash: track.contentHash,
    fileName: track.fileName,
    fileSize: track.fileSize,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  };
  return trackRefHasIdentity(ref) ? ref : null;
}
