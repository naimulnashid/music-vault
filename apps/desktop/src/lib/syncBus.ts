import { trackRefHasIdentity, type SyncOpPayload, type TrackRef } from "@musicvault/core";
import type { Track } from "../types";

/**
 * Decouples the data stores from the sync engine: stores call
 * {@link syncEnqueue} on every user mutation; the sync store installs the
 * real enqueue when a signed-in engine is running. Signed out, the calls are
 * no-ops (there is no library to change then).
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
 * Builds the sync TrackRef for a track, or null when the track has no
 * durable identity yet (local file whose BLAKE3 hash hasn't been computed —
 * the background hasher closes that gap minutes after import).
 */
export function refFromTrack(track: Track): TrackRef | null {
  const ref: TrackRef = {
    remoteId: track.remoteId,
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
