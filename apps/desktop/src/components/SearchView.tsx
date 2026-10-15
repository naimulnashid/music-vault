import { useDeferredValue, useMemo } from "react";
import { motion } from "motion/react";
import { SearchX } from "lucide-react";
import { groupAlbums } from "@musicvault/core";
import { useLibraryStore } from "../store/libraryStore";
import { useUiStore } from "../store/uiStore";
import { TrackList } from "./TrackList";
import { ViewHeader } from "./ViewHeader";
import { AlbumCard, CardGrid, cardMotion } from "./AlbumCard";
import { ArtistAvatar } from "./ArtistAvatar";
import { artKeyOf } from "./AlbumArt";
import type { Track } from "../types";

/** Results for the top-bar search: artists, albums, then every matching song. */
export function SearchView() {
  const tracks = useLibraryStore((s) => s.tracks);
  const search = useLibraryStore((s) => s.search);
  const showArtist = useUiStore((s) => s.showArtist);
  const query = useDeferredValue(search.trim().toLowerCase());

  const { songs, artists, albums } = useMemo(() => {
    if (!query) return { songs: [], artists: [], albums: [] };
    const has = (v?: string) => !!v && v.toLowerCase().includes(query);
    const songs = tracks.filter((t) => has(t.title) || has(t.artist) || has(t.album) || has(t.genre));
    const artistMap = new Map<string, Track | undefined>();
    for (const t of tracks) {
      if (!has(t.artist)) continue;
      if (!artistMap.has(t.artist)) artistMap.set(t.artist, artKeyOf(t) ? t : undefined);
      else if (!artistMap.get(t.artist) && artKeyOf(t)) artistMap.set(t.artist, t);
    }
    const albums = groupAlbums(tracks).filter((a) => has(a.album));
    return { songs, artists: [...artistMap.entries()].slice(0, 12), albums: albums.slice(0, 12) };
  }, [tracks, query]);

  const nothing = query && songs.length === 0 && artists.length === 0 && albums.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader title={search.trim() ? `Results for “${search.trim()}”` : "Search"} />
      {!query && <p className="px-8 text-sm text-muted">Type to search your library.</p>}
      {nothing && (
        <div className="flex flex-col items-center text-center py-16 text-muted">
          <SearchX className="w-12 h-12 mb-4 text-subtle" strokeWidth={1.5} />
          <p className="font-semibold text-fg">No results</p>
          <p className="text-sm mt-1">Try a different spelling, or search by album or genre.</p>
        </div>
      )}

      {artists.length > 0 && (
        <section className="px-6 md:px-8 pb-6">
          <h2 className="text-xl font-bold mb-4">Artists</h2>
          <CardGrid min={130}>
            {artists.map(([name, art], i) => (
              <motion.button key={name} {...cardMotion(i)} onClick={() => showArtist(name)} className="group text-center min-w-0">
                <div className="rounded-full overflow-hidden mb-3">
                  <ArtistAvatar
                    name={name}
                    track={art}
                    className="w-full aspect-square transition-transform duration-500 group-hover:scale-[1.05]"
                  />
                </div>
                <div className="text-sm font-semibold truncate">{name}</div>
                <div className="text-xs text-muted">Artist</div>
              </motion.button>
            ))}
          </CardGrid>
        </section>
      )}

      {albums.length > 0 && (
        <section className="px-6 md:px-8 pb-6">
          <h2 className="text-xl font-bold mb-4">Albums</h2>
          <CardGrid min={150}>
            {albums.map((a, i) => (
              <AlbumCard key={a.key} album={a} index={i} />
            ))}
          </CardGrid>
        </section>
      )}

      {songs.length > 0 && (
        <section className="pb-6">
          <h2 className="px-6 md:px-8 text-xl font-bold mb-2">Songs</h2>
          <TrackList tracks={songs} />
        </section>
      )}
    </div>
  );
}
