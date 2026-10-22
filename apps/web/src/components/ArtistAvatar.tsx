import { useVaultArtUrl } from "../lib/artwork";
import { useArtistPhotoStore } from "../store/artistPhotoStore";
import { AlbumArt, artKeyOf, type ArtSource } from "./AlbumArt";

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
  const photoKey = useArtistPhotoStore((s) => s.photos[name]);
  const photo = useVaultArtUrl(photoKey, !full);
  if (photo) return <img src={photo} alt="" draggable={false} className={`${className} rounded-full object-cover`} />;
  if (photoKey) return <div className={`${className} rounded-full bg-surface-2`} />;
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
