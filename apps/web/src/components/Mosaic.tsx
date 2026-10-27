import { ListMusic, Sparkles } from "lucide-react";
import type { Track } from "../types";
import { AlbumArt, artKeyOf } from "./AlbumArt";
import { CustomCover } from "./CustomCover";
import { useCollectionCoverStore } from "../store/collectionCoverStore";

/**
 * Cover for a collection: the picture picked for it (`collection` is its
 * core collectionKey), else one artwork, or a 2×2 grid of the first four
 * distinct ones; a gradient tile with an icon when nothing has art.
 */
export function Mosaic({
  tracks,
  className = "",
  smart = false,
  collection,
  full = false,
}: {
  tracks: Track[];
  className?: string;
  smart?: boolean;
  collection?: string;
  /** Large heroes load a picked cover at full size. */
  full?: boolean;
}) {
  const custom = useCollectionCoverStore((s) => (collection ? s.covers[collection] : undefined));
  if (custom) return <CustomCover coverKey={custom} thumb={!full} className={className} />;
  const keys = new Set<string>();
  const arts: Track[] = [];
  for (const t of tracks) {
    const key = artKeyOf(t);
    if (key && !keys.has(key)) {
      keys.add(key);
      arts.push(t);
    }
    if (arts.length === 4) break;
  }

  if (arts.length === 0) {
    return (
      <div
        className={`${className} flex items-center justify-center ${
          smart ? "bg-gradient-to-br from-accent to-fuchsia-600 text-white" : "bg-gradient-to-br from-surface-3 to-surface-2 text-muted"
        }`}
      >
        {smart ? <Sparkles className="w-1/3 h-1/3" strokeWidth={1.5} /> : <ListMusic className="w-1/3 h-1/3" strokeWidth={1.5} />}
      </div>
    );
  }
  if (arts.length < 4) {
    return <AlbumArt track={arts[0]} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} grid grid-cols-2 grid-rows-2 overflow-hidden`}>
      {arts.map((a) => (
        <AlbumArt key={a.id} track={a} thumb className="w-full h-full object-cover" />
      ))}
    </div>
  );
}
