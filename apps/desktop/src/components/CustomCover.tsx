import { useEffect } from "react";
import { fetchVaultArt } from "../lib/vault";
import { useLibraryStore } from "../store/libraryStore";
import { AlbumArt } from "./AlbumArt";

/** A picture picked as a cover, from the artwork cache, downloading it there on first use. */
export function CustomCover({ coverKey, thumb = true, className = "" }: { coverKey: string; thumb?: boolean; className?: string }) {
  const path = useLibraryStore((s) => s.vaultArt[coverKey]);
  useEffect(() => {
    if (path) return;
    void fetchVaultArt([coverKey]).then((found) => {
      if (found[coverKey]) useLibraryStore.getState().adoptVaultArt(coverKey, found[coverKey]);
    });
  }, [coverKey, path]);
  if (!path) return <div className={`${className} bg-surface-2`} />;
  return <AlbumArt track={{ artworkPath: path }} thumb={thumb} className={`${className} object-cover`} />;
}
