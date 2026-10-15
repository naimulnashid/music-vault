import { deletedVaultHashes, type TrackRow } from "@musicvault/core";
import { vaultForgetDeleted } from "./ipc";

/** Drops cached/pinned copies of tracks deleted from the vault (here or elsewhere). */
export async function forgetDeletedTracks(rows: TrackRow[]): Promise<void> {
  const hashes = deletedVaultHashes(rows);
  if (hashes.length === 0) return;
  try {
    await vaultForgetDeleted(hashes);
  } catch (err) {
    console.error("[vault] dropping deleted downloads failed:", err);
  }
}
