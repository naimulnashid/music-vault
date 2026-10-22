import { useEffect } from "react";
import { fetchVaultArt } from "../lib/vault";
import { useArtistPhotoStore } from "../store/artistPhotoStore";
import { useLibraryStore } from "../store/libraryStore";
import { AlbumArt, artKeyOf, type ArtSource } from "./AlbumArt";

/** The cached file for an artist's photo, downloading it into the artwork cache on first use. */
function useArtistPhotoPath(name: string): { key?: string; path?: string } {
  const key = useArtistPhotoStore((s) => s.photos[name]);
  const path = useLibraryStore((s) => (key ? s.vaultArt[key] : undefined));
  useEffect(() => {
    if (!key || path) return;
    void fetchVaultArt([key]).then((found) => {
      if (found[key]) useLibraryStore.getState().adoptVaultArt(key, found[key]);
    });
  }, [key, path]);
  return { key, path };
}

/**
 * Round artist picture: the photo picked for them, else their first album's
 * art, else an initial on a tinted disc (SVG text, so it scales with any size).
 * `full` loads the full-size photo for large heroes instead of the thumbnail.
 */
export function ArtistAvatar({
  name,
  track,
  className = "",
  full = false,
}: {
  name: string;
  track?: ArtSource | null;
  className?: string;
  full?: boolean;
}) {
  const photo = useArtistPhotoPath(name);
  if (photo.path) {
    return <AlbumArt track={{ artworkPath: photo.path }} thumb={!full} className={`${className} rounded-full object-cover`} />;
  }
  if (photo.key) return <div className={`${className} rounded-full bg-surface-2`} />;
  if (track && artKeyOf(track)) {
    return <AlbumArt track={track} thumb={!full} className={`${className} rounded-full object-cover`} />;
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={`${className} rounded-full overflow-hidden bg-gradient-to-br from-accent/80 to-fuchsia-600/70 select-none`}>
      <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
        <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fontSize="44" fontWeight="700" fill="#fff">
          {initial}
        </text>
      </svg>
    </div>
  );
}
