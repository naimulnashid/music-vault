import { useMemo } from "react";
import { Disc3 } from "lucide-react";
import { useLibraryStore } from "../store/libraryStore";
import { groupAlbums } from "@musicvault/core";
import { ViewHeader } from "./ViewHeader";
import { AlbumCard, CardGrid } from "./AlbumCard";

export function AlbumGrid() {
  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useMemo(() => groupAlbums(tracks), [tracks]);

  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader title="Albums" subtitle={albums.length > 0 ? `${albums.length} ${albums.length === 1 ? "album" : "albums"}` : undefined} />
      <div className="px-6 md:px-8 pb-10">
        {albums.length === 0 ? (
          <div className="flex flex-col items-center text-center py-20 text-muted">
            <Disc3 className="w-12 h-12 mb-4 text-subtle" strokeWidth={1.5} />
            <p className="font-semibold text-fg">No albums yet</p>
            <p className="text-sm mt-1">Albums appear here as you upload music.</p>
          </div>
        ) : (
          <CardGrid>
            {albums.map((a, i) => (
              <AlbumCard key={a.key} album={a} index={i} />
            ))}
          </CardGrid>
        )}
      </div>
    </div>
  );
}
