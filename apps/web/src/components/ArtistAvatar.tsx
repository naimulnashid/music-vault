import { AlbumArt, artKeyOf, type ArtSource } from "./AlbumArt";

/**
 * Round artist picture: their first album's art, or an initial on a tinted
 * disc when no art exists (SVG text, so it scales with any size).
 */
export function ArtistAvatar({ name, track, className = "" }: { name: string; track?: ArtSource | null; className?: string }) {
  if (track && artKeyOf(track)) {
    return <AlbumArt track={track} thumb className={`${className} rounded-full object-cover`} />;
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
