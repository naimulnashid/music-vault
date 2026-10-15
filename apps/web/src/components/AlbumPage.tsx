import { useMemo } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { useUiStore } from "../store/uiStore";
import { DownloadAllButton } from "./DownloadAllButton";
import { groupAlbums, formatDurationLong } from "@musicvault/core";
import { AlbumArt } from "./AlbumArt";
import { TrackList } from "./TrackList";
import { Hero, PlayShuffleButtons } from "./ViewHeader";
import { NotFound } from "./NotFound";

export function AlbumPage() {
  const tracks = useLibraryStore((s) => s.tracks);
  const activeAlbumKey = useUiStore((s) => s.activeAlbumKey);
  const showArtist = useUiStore((s) => s.showArtist);

  const album = useMemo(() => groupAlbums(tracks).find((a) => a.key === activeAlbumKey), [tracks, activeAlbumKey]);

  if (!album) return <NotFound what="Album" />;

  const totalDuration = album.tracks.reduce((sum, t) => sum + t.duration, 0);
  const year = album.tracks.find((t) => t.year)?.year;

  return (
    <div className="h-full overflow-y-auto">
      <Hero
        kind="Album"
        title={album.album || "Unknown album"}
        artTrack={album.tracks[0]}
        cover={<AlbumArt track={album.tracks[0]} className="w-48 h-48 md:w-56 md:h-56 rounded-xl object-cover" />}
        meta={
          <>
            <button onClick={() => showArtist(album.artist)} className="font-semibold text-fg hover:underline">
              {album.artist}
            </button>
            {year ? <span> • {year}</span> : null}
            <span>
              {" "}
              • {album.tracks.length} {album.tracks.length === 1 ? "song" : "songs"} • {formatDurationLong(totalDuration)}
            </span>
          </>
        }
        actions={
          <>
            <PlayShuffleButtons tracks={album.tracks} />
            <DownloadAllButton tracks={album.tracks} />
          </>
        }
      />
      <TrackList tracks={album.tracks} numbered />
    </div>
  );
}
