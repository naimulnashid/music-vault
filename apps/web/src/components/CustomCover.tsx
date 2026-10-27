import { useVaultArtUrl } from "../lib/artwork";

/** A picture picked as a cover, signed and cached like any vault artwork. */
export function CustomCover({ coverKey, thumb = true, className = "" }: { coverKey: string; thumb?: boolean; className?: string }) {
  const url = useVaultArtUrl(coverKey, thumb);
  if (!url) return <div className={`${className} bg-surface-2`} />;
  return <img src={url} alt="" draggable={false} className={`${className} object-cover`} />;
}
