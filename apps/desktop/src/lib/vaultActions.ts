import { askConfirm, showNotice } from "../components/ConfirmHost";
import { useLibraryStore } from "../store/libraryStore";
import type { Track } from "../types";

/**
 * "Delete from vault" with a confirmation, shared by the track row, the
 * selection bar and the editor. Failures are shown, never swallowed.
 * Returns whether anything was deleted.
 */
export async function confirmDeleteFromVault(tracks: Track[]): Promise<boolean> {
  const inVault = tracks.filter((t) => t.storageKey && t.remoteId);
  if (inVault.length === 0) return false;
  const what = inVault.length === 1 ? `“${inVault[0].title}”` : `these ${inVault.length} tracks`;
  const ok = await askConfirm({
    title: "Delete from vault",
    message: `Delete ${what} from your vault?`,
    detail: "The audio is removed from the cloud, together with favorites, playlist entries and play history. This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return false;
  try {
    await useLibraryStore.getState().deleteFromVault(inVault.map((t) => t.id));
    return true;
  } catch (err) {
    await showNotice("Delete from vault", `Couldn't delete from the vault: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
