import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, Disc3, Download, Library, Plus, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import { useLibraryStore } from "../store/libraryStore";
import { useUiStore } from "../store/uiStore";
import { SMART_PLAYLISTS, collectionKey, sortPlaylists } from "@musicvault/core";
import { SMART_ICONS, type IconType } from "./smartIcons";
import { CustomCover } from "./CustomCover";
import { useCoverContextMenu } from "./CollectionCoverMenu";
import { useCollectionCoverStore } from "../store/collectionCoverStore";
import type { Playlist } from "../types";
import { AlbumArt, artKeyOf } from "./AlbumArt";
import { Logo } from "./Logo";
import { SmartPlaylistDialog } from "./SmartPlaylistDialog";

type Icon = IconType;

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const allPlaylists = useLibraryStore((s) => s.playlists);
  const playlists = useMemo(() => sortPlaylists(allPlaylists), [allPlaylists]);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const mainView = useUiStore((s) => s.mainView);
  const activePlaylistId = useUiStore((s) => s.activePlaylistId);
  const smartKey = useUiStore((s) => s.smartKey);
  const showTracks = useUiStore((s) => s.showTracks);
  const showAlbums = useUiStore((s) => s.showAlbums);
  const showSmart = useUiStore((s) => s.showSmart);
  const showPlaylist = useUiStore((s) => s.showPlaylist);
  const showStats = useUiStore((s) => s.showStats);
  const showDownloads = useUiStore((s) => s.showDownloads);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const [creating, setCreating] = useState(false);
  const [smartDialog, setSmartDialog] = useState(false);
  const [name, setName] = useState("");
  const [smartOpen, setSmartOpen] = useState(true);

  const cancelCreate = () => {
    setCreating(false);
    setName("");
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed && creating) {
      showPlaylist(await createPlaylist(trimmed));
    }
    setName("");
    setCreating(false);
  };

  const nav: { label: string; icon: Icon; active: boolean; onClick: () => void }[] = [
    { label: "Library", icon: Library, active: mainView === "tracks", onClick: showTracks },
    { label: "Albums", icon: Disc3, active: mainView === "albums" || mainView === "album", onClick: showAlbums },
    {
      label: "Statistics",
      icon: BarChart3,
      active: mainView === "stats" || mainView === "recap" || mainView === "heatmap",
      onClick: showStats,
    },
    { label: "Downloads", icon: Download, active: mainView === "downloads", onClick: showDownloads },
  ];

  if (collapsed) {
    return (
      <nav className="w-[76px] h-full flex flex-col items-center pt-1 pb-3">
        <div className="flex flex-col items-center gap-1 shrink-0">
          {nav.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className={`w-16 flex flex-col items-center gap-1 py-3 rounded-xl text-[10px] font-medium transition-colors ${
                item.active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg"
              }`}
            >
              <item.icon
                className={`w-6 h-6 ${item.active ? "text-accent" : ""}`}
                strokeWidth={item.active ? 2.2 : 1.8}
              />
              {item.label}
            </button>
          ))}
        </div>
        {playlists.length > 0 && (
          <>
            <div className="my-3 w-10 h-px shrink-0 bg-line" />
            <div className="flex-1 min-h-0 w-full overflow-y-auto mv-quiet-scroll flex flex-col items-center gap-2 pb-1">
              {playlists.map((p) => (
                <RailPlaylist
                  key={p.id}
                  playlist={p}
                  active={mainView === "playlist" && activePlaylistId === p.id}
                  onClick={() => showPlaylist(p.id)}
                />
              ))}
            </div>
          </>
        )}
      </nav>
    );
  }

  return (
    <div className="w-60 h-full flex flex-col bg-bg md:bg-transparent">
      {/* Drawer header (mobile only; desktop has the top bar). */}
      <div className="md:hidden h-16 px-4 flex items-center justify-between shrink-0">
        <Logo className="flex" />
        <button
          onClick={() => setSidebarOpen(false)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-2"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 mv-quiet-scroll">
        <nav className="space-y-0.5 pt-1">
          {nav.map((item) => (
            <NavItem key={item.label} icon={item.icon} label={item.label} active={item.active} onClick={item.onClick} />
          ))}
        </nav>

        <div className="my-4 mx-3 h-px bg-line" />

        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => setCreating(true)}
            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-full bg-surface-2 hover:bg-surface-3 text-sm font-semibold transition-[background-color,transform] active:scale-[0.97]"
          >
            <Plus className="w-4 h-4" /> New playlist
          </button>
          <button
            onClick={() => setSmartDialog(true)}
            title="New smart playlist (fills itself from rules)"
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-surface-2 hover:bg-surface-3 text-accent transition-[background-color,transform] active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>

        {creating && (
          <motion.form
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-1 mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            // Leaving the form (not moving to its own buttons) still saves a typed name.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void handleCreate();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelCreate();
              }}
              placeholder="Playlist name"
              aria-label="Playlist name"
              className="mv-field"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!name.trim()}
                className="flex-1 h-8 rounded-full text-sm font-semibold bg-accent text-accent-fg hover:bg-accent-hover transition-colors disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={cancelCreate}
                className="flex-1 h-8 rounded-full text-sm font-semibold bg-surface-2 hover:bg-surface-3 transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.form>
        )}

        <button
          onClick={() => setSmartOpen(!smartOpen)}
          aria-expanded={smartOpen}
          className="w-full mt-5 mb-1 px-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.08em] text-subtle hover:text-muted transition-colors"
        >
          Smart playlists
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${smartOpen ? "" : "-rotate-90"}`} />
        </button>
        <motion.nav
          initial={false}
          animate={{ height: smartOpen ? "auto" : 0, opacity: smartOpen ? 1 : 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden space-y-0.5"
        >
          {SMART_PLAYLISTS.map((sp) => (
            <NavItem
              key={sp.key}
              icon={SMART_ICONS[sp.key]}
              label={sp.label}
              active={mainView === "smart" && smartKey === sp.key}
              onClick={() => showSmart(sp.key)}
              compact
            />
          ))}
        </motion.nav>

        {playlists.length > 0 && (
          <>
            <div className="mt-5 mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-subtle">
              Your playlists
            </div>
            <nav className="space-y-0.5">
              {playlists.map((p) => (
                <PlaylistItem
                  key={p.id}
                  playlist={p}
                  active={mainView === "playlist" && activePlaylistId === p.id}
                  onClick={() => showPlaylist(p.id)}
                />
              ))}
            </nav>
          </>
        )}
      </div>
      <SmartPlaylistDialog open={smartDialog} onClose={() => setSmartDialog(false)} />
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  compact = false,
}: {
  icon: Icon;
  label: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full flex items-center gap-4 px-3 rounded-xl text-sm transition-colors duration-150 ${
        compact ? "h-9" : "h-11"
      } ${active ? "text-fg font-semibold" : "text-muted hover:text-fg hover:bg-surface-2/60"}`}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-xl bg-surface-2"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <Icon className={`relative w-5 h-5 shrink-0 ${active ? "text-accent" : ""}`} strokeWidth={active ? 2.2 : 1.8} />
      <span className="relative truncate">{label}</span>
    </button>
  );
}

/**
 * A playlist's small cover: the first song's artwork, else the first letter of
 * its name (smart playlists such as one per language read best by letter).
 */
function PlaylistCover({ playlist, className = "" }: { playlist: Playlist; className?: string }) {
  const custom = useCollectionCoverStore((s) => s.covers[collectionKey("playlist", playlist.id)]);
  const firstTrack = useLibraryStore((s) => {
    if (playlist.isSmart || playlist.trackIds.length === 0) return undefined;
    const first = s.tracks.find((t) => t.id === playlist.trackIds[0]);
    return first && artKeyOf(first) ? first : undefined;
  });
  if (custom) return <CustomCover coverKey={custom} className={`relative rounded-lg shrink-0 ${className}`} />;
  if (firstTrack) {
    return <AlbumArt track={firstTrack} thumb className={`relative rounded-lg object-cover shrink-0 ${className}`} />;
  }
  const label = coverLetters(playlist.name);
  return (
    <span
      className={`relative rounded-lg shrink-0 flex items-center justify-center font-bold ${
        label.length > 1 ? "text-[11px] tracking-tight" : "text-base"
      } ${
        playlist.isSmart ? "bg-gradient-to-br from-accent/80 to-fuchsia-500/70 text-white" : "bg-surface-2 text-muted"
      } ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * First letter of the name, plus the first letter of a bracketed qualifier:
 * "Bangla (Bangladesh)" → "B(B)", "Bangla (India)" → "B(I)".
 */
function coverLetters(name: string): string {
  const initial = (text: string) => [...text.trim()][0]?.toLocaleUpperCase() ?? "";
  const qualifier = /\(([^)]+)\)/.exec(name)?.[1];
  const head = initial(name.replace(/\([^)]*\)/g, "")) || initial(name) || "?";
  return qualifier && initial(qualifier) ? `${head}(${initial(qualifier)})` : head;
}

/** A playlist on the collapsed rail: its cover alone, with the same right-click menu. */
function RailPlaylist({ playlist, active, onClick }: { playlist: Playlist; active: boolean; onClick: () => void }) {
  const context = useCoverContextMenu(collectionKey("playlist", playlist.id));
  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={context.onContextMenu}
        title={playlist.name}
        aria-label={playlist.name}
        className={`shrink-0 rounded-xl p-1 transition-colors ${active ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
      >
        <PlaylistCover playlist={playlist} className={`w-11 h-11 ${active ? "ring-2 ring-accent" : ""}`} />
      </button>
      {context.menu}
    </>
  );
}

function PlaylistItem({ playlist, active, onClick }: { playlist: Playlist; active: boolean; onClick: () => void }) {
  const context = useCoverContextMenu(collectionKey("playlist", playlist.id));
  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={context.onContextMenu}
        className={`relative w-full flex items-center gap-3 h-12 px-2 rounded-xl text-sm text-left transition-colors duration-150 ${
          active ? "text-fg font-semibold" : "text-muted hover:text-fg hover:bg-surface-2/60"
        }`}
      >
        {active && (
          <motion.span
            layoutId="sidebar-active"
            className="absolute inset-0 rounded-xl bg-surface-2"
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
          />
        )}
        <PlaylistCover playlist={playlist} className="w-9 h-9" />
        <span className="relative min-w-0 flex-1">
          <span className="block truncate">{playlist.name}</span>
          <span className="block truncate text-xs font-normal text-subtle">
            {playlist.isSmart
              ? "Smart playlist"
              : `${playlist.trackIds.length} ${playlist.trackIds.length === 1 ? "song" : "songs"}`}
          </span>
        </span>
      </button>
      {context.menu}
    </>
  );
}
