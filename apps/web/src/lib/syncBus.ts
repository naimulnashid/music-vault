import { trackRefHasIdentity, type SyncOpPayload, type TrackRef } from "@musicvault/core";
import type { Track } from "../types";

/**
 * Decouples the data stores from the sync engine: stores call
 * {@link syncEnqueue} on every user mutation; the sync store installs the
 * real enqueue when a signed-in engine is running.
 */

let enqueueFn: ((payload: SyncOpPayload) => void) | null = null;

export function setSyncEnqueue(fn: ((payload: SyncOpPayload) => void) | null): void {
  enqueueFn = fn;
}

export function syncEnqueue(payload: SyncOpPayload): void {
  enqueueFn?.(payload);
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
