import type { UploadOutcome } from "@musicvault/core";
import { storageExt } from "./vaultMerge";

export interface UploadCacheCopy {
  path: string;
  contentHash: string;
  ext: string;
}

/**
 * The file to copy into this PC's cache after an upload, so its first play
 * doesn't download what this PC already has, named with the extension the
 * vault stored it under. Null when nothing was uploaded.
 */
export function uploadCacheCopy(
  outcome: UploadOutcome,
  source: { path: string; contentHash: string },
): UploadCacheCopy | null {
  if (outcome.status === "already-in-vault") return null;
  return { path: source.path, contentHash: source.contentHash, ext: storageExt(outcome.storageKey) };
}
