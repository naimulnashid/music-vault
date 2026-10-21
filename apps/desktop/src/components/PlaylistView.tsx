import { useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { MoreHorizontal, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useLibraryStore } from "../store/libraryStore";
import { useHistoryStore } from "../store/historyStore";
import { useUiStore } from "../store/uiStore";
import { TrackList } from "./TrackList";
import { DownloadAllButton } from "./DownloadAllButton";
import { SmartPlaylistDialog } from "./SmartPlaylistDialog";
import { AddSongsDialog } from "./AddSongsDialog";
import { evaluateSmartPlaylist } from "../lib/smartEval";
import { emptySmartRules, formatDurationLong } from "@musicvault/core";
import type { Track } from "../types";
import { Hero, PlayShuffleButtons } from "./ViewHeader";
import { Mosaic } from "./Mosaic";
import { artKeyOf } from "./AlbumArt";
import { NotFound } from "./NotFound";
import { Button, IconButton } from "./ui/Button";
import { Menu, anchorFromElement, type MenuAnchor } from "./ui/Menu";

export function PlaylistView() {
  const activePlaylistId = useUiStore((s) => s.activePlaylistId);
  const showTracks = useUiStore((s) => s.showTracks);
  const playlists = useLibraryStore((s) => s.playlists);
  const tracks = useLibraryStore((s) => s.tracks);
  const renamePlaylist = useLibraryStore((s) => s.renamePlaylist);
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);
  const removeTrackFromPlaylist = useLibraryStore((s) => s.removeTrackFromPlaylist);
  const reorderPlaylist = useLibraryStore((s) => s.reorderPlaylist);
  const playCounts = useHistoryStore((s) => s.playCounts);
  const lastPlayedAt = useHistoryStore((s) => s.lastPlayedAt);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [addingSongs, setAddingSongs] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const playlist = playlists.find((p) => p.id === activePlaylistId);

  const playlistTracks = useMemo(() => {
    if (!playlist) return [];
    if (playlist.isSmart) {
      return evaluateSmartPlaylist(playlist.smartRules ?? emptySmartRules(), tracks, { playCounts, lastPlayedAt });
    }
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return playlist.trackIds.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
  }, [playlist, tracks, playCounts, lastPlayedAt]);

  if (!playlist) return <NotFound what="Playlist" />;

  const startEdit = () => {
    setName(playlist.name);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = name.trim();
    if (trimmed) void renamePlaylist(playlist.id, trimmed);
    setEditing(false);
  };

  const handleDelete = async () => {
    const ok = await ask(`Delete the playlist “${playlist.name}”? The songs stay in your library.`, {
      title: "Delete playlist",
      kind: "warning",
    });
    if (!ok) return;
    void deletePlaylist(playlist.id);
    showTracks();
  };

  const total = playlistTracks.reduce((sum, t) => sum + t.duration, 0);

  return (
    <div className="h-full overflow-y-auto">
      <Hero
        kind={playlist.isSmart ? "Smart playlist" : "Playlist"}
        artTrack={playlistTracks.find((t) => artKeyOf(t))}
        cover={<Mosaic tracks={playlistTracks} smart={playlist.isSmart} className="w-48 h-48 md:w-56 md:h-56 rounded-xl" />}
        title={
          editing ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={commitEdit}
              className="w-full bg-transparent border-b-2 border-accent outline-none"
            />
          ) : (
            <span onDoubleClick={startEdit} title="Double-click to rename">
              {playlist.name}
            </span>
          )
        }
        meta={`${playlistTracks.length} ${playlistTracks.length === 1 ? "song" : "songs"}${
          total > 0 ? ` • ${formatDurationLong(total)}` : ""
        }`}
        actions={
          <>
            <PlayShuffleButtons tracks={playlistTracks} />
            {playlist.isSmart && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => setShowRules(true)}
                icon={<SlidersHorizontal className="w-4 h-4" />}
              >
                Rules
              </Button>
            )}
            <DownloadAllButton tracks={playlistTracks} />
            <IconButton
              ref={moreRef}
              label="More"
              size="md"
              onClick={() => moreRef.current && setMenuAnchor(anchorFromElement(moreRef.current))}
            >
              <MoreHorizontal className="w-5 h-5" />
            </IconButton>
          </>
        }
      />
      <Menu
        anchor={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        items={[
          { label: "Rename", icon: <Pencil />, onSelect: startEdit },
          { label: "Delete playlist", icon: <Trash2 />, danger: true, onSelect: () => void handleDelete() },
        ]}
      />

      {playlist.isSmart && (
        <SmartPlaylistDialog open={showRules} onClose={() => setShowRules(false)} playlist={playlist} />
      )}
      {!playlist.isSmart && (
        <AddSongsDialog open={addingSongs} onClose={() => setAddingSongs(false)} playlist={playlist} />
      )}

      {playlistTracks.length === 0 ? (
        playlist.isSmart ? (
          <p className="px-8 py-10 text-center text-sm text-muted">No songs match these rules yet.</p>
        ) : (
          <div className="px-8 py-10 flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-muted">This playlist is empty.</p>
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setAddingSongs(true)}>
              Add songs
            </Button>
          </div>
        )
      ) : playlist.isSmart ? (
        <TrackList tracks={playlistTracks} />
      ) : (
        <TrackList
          tracks={playlistTracks}
          draggable
          onReorder={(reordered) => void reorderPlaylist(playlist.id, reordered.map((t) => t.id))}
          onRemoveFromPlaylist={(id) => void removeTrackFromPlaylist(playlist.id, id)}
        />
      )}
    </div>
  );
}
