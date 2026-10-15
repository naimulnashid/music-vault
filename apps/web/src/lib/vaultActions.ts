import { useLibraryStore } from "../store/libraryStore";
import type { Track } from "../types";

/** "Delete from vault" with a confirmation; failures are shown, not swallowed. */
export async function confirmDeleteFromVault(tracks: Track[]): Promise<boolean> {
  const inVault = tracks.filter((t) => t.storageKey);
  if (inVault.length === 0) return false;
  const what = inVault.length === 1 ? `“${inVault[0].title}”` : `these ${inVault.length} tracks`;
  const ok = window.confirm(
    `Delete ${what} from your vault?\n\nThe audio is removed from the cloud, together with favorites, playlist entries and play history. This can't be undone.`,
  );
  if (!ok) return false;
  try {
    await useLibraryStore.getState().deleteFromVault(inVault.map((t) => t.id));
    return true;
  } catch (err) {
    window.alert(`Couldn't delete from the vault: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
