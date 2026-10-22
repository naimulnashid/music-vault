import { useMemo } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { useUiStore } from "../store/uiStore";
import { groupAlbums, formatDurationLong, hasArtist } from "@musicvault/core";
import { DownloadAllButton } from "./DownloadAllButton";
import { TrackCollection } from "./TrackCollection";
import { Hero, PlayShuffleButtons } from "./ViewHeader";
import { AlbumCard, CardGrid } from "./AlbumCard";
import { ArtistAvatar } from "./ArtistAvatar";
import { artKeyOf } from "./AlbumArt";
import { NotFound } from "./NotFound";
import { ArtistPhotoMenu } from "./ArtistPhotoMenu";

export function ArtistPage() {
  const tracks = useLibraryStore((s) => s.tracks);
  const activeArtist = useUiStore((s) => s.activeArtist);

  const artistTracks = useMemo(
    () =>
      tracks
        .filter((t) => activeArtist !== null && hasArtist(t, activeArtist))
        .sort((a, b) => a.album.localeCompare(b.album) || a.title.localeCompare(b.title)),
    [tracks, activeArtist],
  );
  const albums = useMemo(() => groupAlbums(artistTracks), [artistTracks]);
  const totalDuration = useMemo(() => artistTracks.reduce((sum, t) => sum + t.duration, 0), [artistTracks]);

  if (!activeArtist || artistTracks.length === 0) return <NotFound what="Artist" />;

  const art = artistTracks.find((t) => artKeyOf(t));

  return (
    <div className="h-full overflow-y-auto">
      <Hero
        kind="Artist"
        title={activeArtist}
        artTrack={art}
        cover={<ArtistAvatar name={activeArtist} track={art} full className="w-48 h-48 md:w-56 md:h-56" />}
        meta={`${albums.length} ${albums.length === 1 ? "album" : "albums"} • ${artistTracks.length} ${
          artistTracks.length === 1 ? "song" : "songs"
        } • ${formatDurationLong(totalDuration)}`}
        actions={
          <>
            <PlayShuffleButtons tracks={artistTracks} />
            <DownloadAllButton tracks={artistTracks} />
            <ArtistPhotoMenu artist={activeArtist} />
          </>
        }
      />

      <TrackCollection page="artist" tracks={artistTracks} toolbar={<h2 className="pt-2 text-xl font-bold">Songs</h2>} />

      {albums.length > 0 && (
        <section className="px-6 md:px-8 pt-6 pb-10">
          <h2 className="text-xl font-bold mb-4">Albums</h2>
          <CardGrid min={150}>
            {albums.map((a, i) => (
              <AlbumCard key={a.key} album={a} index={i} showArtist={false} />
            ))}
          </CardGrid>
        </section>
      )}
    </div>
  );
}
