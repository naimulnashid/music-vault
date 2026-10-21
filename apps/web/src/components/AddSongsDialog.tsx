import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useLibraryStore } from "../store/libraryStore";
import type { Playlist } from "../types";
import { AlbumArt } from "./AlbumArt";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

/** Rows shown at once; a search narrows a big library to what fits. */
const MAX_ROWS = 100;

/** Picks songs from the library straight into a playlist, without leaving it. */
export function AddSongsDialog({ playlist, open, onClose }: { playlist: Playlist; open: boolean; onClose: () => void }) {
  const tracks = useLibraryStore((s) => s.tracks);
  const addTrackToPlaylist = useLibraryStore((s) => s.addTrackToPlaylist);
  const [query, setQuery] = useState("");
  const inPlaylist = useMemo(() => new Set(playlist.trackIds), [playlist.trackIds]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => [t.title, t.artist, t.album].some((v) => v?.toLowerCase().includes(q)));
  }, [tracks, query]);

  return (
    <Dialog open={open} onClose={onClose} title={`Add songs to “${playlist.name}”`} widthClass="max-w-lg">
      <div className="px-5 pb-3 shrink-0">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, artist or album"
          aria-label="Search your library"
          className="mv-field"
        />
      </div>
      {/* A fixed height keeps the dialog from jumping as the search narrows. */}
      <ul className="h-[min(28rem,60vh)] min-h-0 overflow-y-auto px-2">
        {matches.slice(0, MAX_ROWS).map((t) => {
          const added = inPlaylist.has(t.id);
          return (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2">
              <AlbumArt track={t} thumb className="w-10 h-10 rounded-md object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="truncate text-xs text-muted">{t.artist}</div>
              </div>
              <button
                // aria-disabled, not disabled: a disabled button drops keyboard focus to the page.
                onClick={() => !added && void addTrackToPlaylist(playlist.id, t.id)}
                aria-disabled={added}
                aria-label={added ? `${t.title} is in the playlist` : `Add ${t.title}`}
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-surface-2 hover:bg-surface-3 aria-disabled:bg-transparent aria-disabled:text-accent aria-disabled:cursor-default transition-colors"
              >
                {added ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </button>
            </li>
          );
        })}
        {matches.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No songs match “{query.trim()}”.</li>}
      </ul>
      <div className="flex items-center gap-3 px-5 py-4 border-t border-line shrink-0">
        <span className="flex-1 text-xs text-muted">
          {matches.length > MAX_ROWS ? `First ${MAX_ROWS} of ${matches.length}; search to narrow.` : ""}
        </span>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
