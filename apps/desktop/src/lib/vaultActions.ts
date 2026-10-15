import { ask, message } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "../store/libraryStore";
import type { Track } from "../types";

/**
 * "Delete from vault" with a confirmation, shared by the track row, the
 * selection bar and the editor. Uses the plain Yes/No dialog: custom button
 * labels aren't reported back reliably on Windows, which made a confirmed
 * delete read as "cancel". Failures are shown, never swallowed.
 * Returns whether anything was deleted.
 */
export async function confirmDeleteFromVault(tracks: Track[]): Promise<boolean> {
  const inVault = tracks.filter((t) => t.storageKey && t.remoteId);
  if (inVault.length === 0) return false;
  const what = inVault.length === 1 ? `“${inVault[0].title}”` : `these ${inVault.length} tracks`;
  const ok = await ask(
    `Delete ${what} from your vault?\n\nThe audio is removed from the cloud, together with favorites, playlist entries and play history. This can't be undone.`,
    { title: "Delete from vault", kind: "warning" },
  );
  if (!ok) return false;
  try {
    await useLibraryStore.getState().deleteFromVault(inVault.map((t) => t.id));
    return true;
  } catch (err) {
    await message(`Couldn't delete from the vault: ${err instanceof Error ? err.message : String(err)}`, {
      title: "Delete from vault",
      kind: "error",
    });
    return false;
  }
}
