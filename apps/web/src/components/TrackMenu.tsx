import { useCallback, useState } from "react";
import {
  CheckCircle2,
  CloudOff,
  Disc3,
  Download,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  MinusCircle,
  Pencil,
  UserRound,
} from "lucide-react";
import { albumKey, sortPlaylists } from "@musicvault/core";
import type { Track } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import { canDeleteFromVault, downloadTracks, removeDownload, useIsPinned } from "../lib/trackState";
import { useUiStore } from "../store/uiStore";
import { useAuthStore } from "../store/authStore";
import { confirmDeleteFromVault } from "../lib/vaultActions";
import { AlbumArt } from "./AlbumArt";
import { Menu, type MenuAnchor, type MenuEntry } from "./ui/Menu";

export interface TrackMenuOptions {
  /** Present inside a manual playlist. */
  onRemoveFromPlaylist?: () => void;
  /** Tracks the "Edit" entry edits (defaults to just this one). */
  editIds?: string[];
}

interface OpenMenu {
  anchor: MenuAnchor;
  track: Track;
  opts: TrackMenuOptions;
}

/**
 * The one song menu (row "⋮", right-click, player bar): queue actions,
 * playlists, navigation, download and vault actions.
 */
export function useTrackMenu() {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const openMenu = useCallback((anchor: MenuAnchor, track: Track, opts: TrackMenuOptions = {}) => {
    setOpen({ anchor, track, opts });
  }, []);
  const close = useCallback(() => setOpen(null), []);
  const element = <TrackMenu open={open} onClose={close} />;
  return { openMenu, menu: element, openTrackId: open?.track.id ?? null };
}

function TrackMenu({ open, onClose }: { open: OpenMenu | null; onClose: () => void }) {
  const allPlaylists = useLibraryStore((s) => s.playlists);
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  const liveTrack = useLibraryStore((s) => (open ? s.tracks.find((t) => t.id === open.track.id) : undefined));
  const pinned = useIsPinned(liveTrack ?? open?.track);

  let items: MenuEntry[] = [];
  let header = null;
  if (open) {
    const track = liveTrack ?? open.track;
    const { opts } = open;
    const player = usePlayerStore.getState();
    const library = useLibraryStore.getState();
    const ui = useUiStore.getState();
    const manual = sortPlaylists(allPlaylists.filter((p) => !p.isSmart));

    header = (
      <div className="flex items-center gap-3 min-w-0">
        <AlbumArt track={track} thumb className="w-10 h-10 rounded-md object-cover shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{track.title}</div>
          <div className="text-xs text-muted truncate">{track.artist}</div>
        </div>
      </div>
    );

    items = [
      { label: "Play next", icon: <ListStart />, onSelect: () => player.playNext([track]) },
      { label: "Add to queue", icon: <ListEnd />, onSelect: () => player.addToQueue([track]) },
      {
        label: "Add to playlist",
        icon: <ListPlus />,
        emptyText: "No playlists yet — create one in the sidebar",
        submenu: manual.map((p) => ({
          label: p.name,
          onSelect: () => void library.addTrackToPlaylist(p.id, track.id),
        })),
      },
      {
        label: track.favorite ? "Remove from favorites" : "Add to favorites",
        icon: <Heart className={track.favorite ? "fill-accent text-accent" : ""} />,
        onSelect: () => void library.toggleFavorite(track.id),
      },
      "divider",
      { label: "Go to album", icon: <Disc3 />, onSelect: () => ui.showAlbum(albumKey(track)) },
      { label: "Go to artist", icon: <UserRound />, onSelect: () => ui.showArtist(track.artist) },
      "divider",
    ];

    if (track.storageKey) {
      items.push(
        pinned
          ? {
              label: "Remove download",
              icon: <CheckCircle2 className="text-accent" />,
              onSelect: () => void removeDownload(track),
            }
          : {
              label: "Download",
              icon: <Download />,
              onSelect: () => void downloadTracks([track]),
            },
      );
    }
    if (signedIn) {
      const ids = opts.editIds && opts.editIds.length > 0 ? opts.editIds : [track.id];
      items.push({
        label: ids.length > 1 ? `Edit ${ids.length} songs` : "Edit details",
        icon: <Pencil />,
        onSelect: () => ui.openEditor(ids),
      });
    }
    if (opts.onRemoveFromPlaylist) {
      items.push({ label: "Remove from playlist", icon: <MinusCircle />, onSelect: opts.onRemoveFromPlaylist });
    }
    if (signedIn && canDeleteFromVault(track)) {
      items.push("divider", {
        label: "Delete from vault",
        icon: <CloudOff />,
        danger: true,
        onSelect: () => void confirmDeleteFromVault([track]),
      });
    }
    if (items[items.length - 1] === "divider") items.pop();
  }

  return <Menu anchor={open?.anchor ?? null} items={items} onClose={onClose} header={header} />;
}
