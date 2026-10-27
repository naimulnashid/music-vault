import { memo, useState } from "react";
import { CloudOff, GripVertical, Heart, MoreVertical, Pause, Pencil, Play, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "motion/react";
import type { Track } from "../types";
import { AlbumArt } from "./AlbumArt";
import { albumKey, formatTime } from "@musicvault/core";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import { useUiStore } from "../store/uiStore";
import { useAuthStore } from "../store/authStore";
import { confirmDeleteFromVault } from "../lib/vaultActions";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { useTrackMenu, type TrackMenuOptions } from "./TrackMenu";
import { anchorFromElement, type MenuAnchor } from "./ui/Menu";
import { NowPlayingBars } from "./NowPlayingBars";
import { DownloadRing } from "./DownloadRing";

/** Every row is exactly this tall (h-14) — the virtual window depends on it. */
const ROW_HEIGHT = 56;

interface TrackListProps {
  tracks: Track[];
  draggable?: boolean;
  onReorder?: (tracks: Track[]) => void;
  onRemoveFromPlaylist?: (trackId: string) => void;
  /** Show the leading position number instead of nothing (album pages). */
  numbered?: boolean;
}

interface RowProps {
  track: Track;
  index: number;
  draggable?: boolean;
  numbered?: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  handlePlay: (index: number) => void;
  selected: boolean;
  /** Ctrl/⌘-click toggles, Shift-click extends; returns true when it consumed the click. */
  onSelectClick: (index: number, e: React.MouseEvent) => boolean;
  onMenu: (anchor: MenuAnchor, track: Track) => void;
  menuOpen: boolean;
}

// Reorder uses pointer-event drag (@dnd-kit) rather than HTML5 drag-and-drop:
// the webview's native drag events are reserved for dropping audio files from
// the OS onto the window.
const TrackRow = memo(function TrackRow({
  track,
  index,
  draggable,
  numbered,
  isCurrent,
  isPlaying,
  handlePlay,
  selected,
  onSelectClick,
  onMenu,
  menuOpen,
}: RowProps) {
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const showArtist = useUiStore((s) => s.showArtist);
  const showAlbum = useUiStore((s) => s.showAlbum);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY }, track);
      }}
      onDoubleClick={() => handlePlay(index)}
      // Double-click plays; without this it would also select a word.
      onMouseDown={(e) => e.detail > 1 && e.preventDefault()}
      className={`group flex items-center gap-3 mx-2 md:mx-4 px-2 h-14 rounded-lg transition-colors duration-100 ${
        selected ? "bg-accent-soft" : menuOpen ? "bg-surface-2" : "hover:bg-surface-2"
      } ${isDragging ? "relative z-10 bg-surface-3 shadow-xl" : ""}`}
    >
      {draggable && (
        <button
          {...attributes}
          {...listeners}
          className="touch-none cursor-grab active:cursor-grabbing shrink-0 -ml-1 text-subtle hover:text-fg"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      {numbered && (
        <span className="w-6 shrink-0 text-right text-sm text-muted tabular-nums">
          {isCurrent ? <NowPlayingBars playing={isPlaying} className="text-accent" /> : index + 1}
        </span>
      )}
      <button
        onClick={() => handlePlay(index)}
        className="relative shrink-0 rounded-md overflow-hidden"
        aria-label={isCurrent && isPlaying ? "Pause" : "Play"}
      >
        <AlbumArt track={track} thumb className="w-10 h-10 rounded-md object-cover" />
        <span
          className={`absolute inset-0 flex items-center justify-center bg-black/50 text-white transition-opacity duration-150 ${
            isCurrent && !numbered ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {isCurrent && !numbered && (
            <span className="group-hover:hidden">
              <NowPlayingBars playing={isPlaying} />
            </span>
          )}
          <span className={isCurrent && !numbered ? "hidden group-hover:block" : ""}>
            {isCurrent && isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          </span>
        </span>
      </button>
      <div
        className="min-w-0 flex-1 cursor-default"
        onClick={(e) => {
          if (!onSelectClick(index, e)) handlePlay(index);
        }}
      >
        <div className={`truncate text-sm font-medium ${isCurrent ? "text-accent" : ""}`}>{track.title}</div>
        <div className="truncate text-xs text-muted">
          <button
            onClick={(e) => {
              e.stopPropagation();
              showArtist(track.artist);
            }}
            className="hover:text-fg hover:underline"
          >
            {track.artist}
          </button>
          {track.album && (
            <span className="lg:hidden">
              <span className="mx-1.5 text-subtle">•</span>
              {track.album}
            </span>
          )}
        </div>
      </div>
      <div className="hidden lg:block w-[30%] min-w-0 shrink-0">
        {track.album && (
          <button
            onClick={() => showAlbum(albumKey(track))}
            className="max-w-full truncate text-sm text-muted hover:text-fg hover:underline text-left"
          >
            {track.album}
          </button>
        )}
      </div>
      <DownloadRing track={track} />
      <button
        onClick={() => void toggleFavorite(track.id)}
        title={track.favorite ? "Remove from favorites" : "Add to favorites"}
        className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-[opacity,color,background-color] hover:bg-surface-3 ${
          track.favorite ? "text-accent" : "opacity-0 group-hover:opacity-100 text-muted hover:text-fg"
        }`}
      >
        <Heart key={String(track.favorite)} className={`w-4 h-4 ${track.favorite ? "fill-current animate-pop" : ""}`} />
      </button>
      <span className="w-11 text-right text-xs text-muted tabular-nums shrink-0">{formatTime(track.duration)}</span>
      <button
        onClick={(e) => onMenu(anchorFromElement(e.currentTarget), track)}
        title="More"
        className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-3 transition-opacity ${
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
});

export function TrackList({ tracks, draggable, onReorder, onRemoveFromPlaylist, numbered }: TrackListProps) {
  const currentId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  const openEditor = useUiStore((s) => s.openEditor);
  const { openMenu, menu, openTrackId: menuTrackId } = useTrackMenu();

  // Selection survives list changes only for tracks still shown.
  const selectedIds = tracks.filter((t) => selection.has(t.id)).map((t) => t.id);

  const onSelectClick = (index: number, e: React.MouseEvent): boolean => {
    const id = tracks[index].id;
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      setSelection(new Set([...selection, ...tracks.slice(a, b + 1).map((t) => t.id)]));
      return true;
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelection(next);
      setAnchor(index);
      return true;
    }
    if (selection.size > 0) {
      setSelection(new Set());
      setAnchor(null);
    }
    return false;
  };

  const onMenu = (menuAnchor: MenuAnchor, track: Track) => {
    const opts: TrackMenuOptions = {
      // Editing a selected row edits the whole selection.
      editIds: selection.has(track.id) ? selectedIds : [track.id],
      onRemoveFromPlaylist: onRemoveFromPlaylist ? () => onRemoveFromPlaylist(track.id) : undefined,
    };
    openMenu(menuAnchor, track, opts);
  };

  const deleteSelectedFromVault = async () => {
    if (await confirmDeleteFromVault(tracks.filter((t) => selection.has(t.id)))) setSelection(new Set());
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handlePlay = (index: number) => {
    const track = tracks[index];
    if (currentId === track.id) togglePlay();
    else playQueue(tracks, index);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;
    const fromIndex = tracks.findIndex((t) => t.id === active.id);
    const toIndex = tracks.findIndex((t) => t.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...tracks];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorder(next);
  };

  // Windowed rendering: only rows near the viewport mount, so 50k-track
  // libraries stay smooth. Rows are fixed-height (ROW_HEIGHT); spacer divs
  // stand in for everything outside the window.
  const { listRef, start, end, padTop, padBottom } = useVirtualRows(tracks.length, ROW_HEIGHT);

  if (tracks.length === 0) {
    return <p className="text-sm text-muted px-6 py-8">No songs here yet.</p>;
  }

  const rows = tracks.slice(start, end).map((track, i) => (
    <TrackRow
      key={`${track.id}-${start + i}`}
      track={track}
      index={start + i}
      draggable={draggable}
      numbered={numbered}
      isCurrent={currentId === track.id}
      isPlaying={isPlaying}
      handlePlay={handlePlay}
      selected={selection.has(track.id)}
      onSelectClick={onSelectClick}
      onMenu={onMenu}
      menuOpen={menuTrackId === track.id}
    />
  ));

  const vaultSelected = tracks.filter((t) => selection.has(t.id) && t.storageKey).length;

  const list = (
    <div ref={listRef} className="pb-4">
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="sticky top-2 z-20 mx-4 mb-2 flex items-center gap-2 pl-4 pr-2 h-12 rounded-full bg-surface-3 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)] text-sm"
          >
            <span className="font-semibold">{selectedIds.length} selected</span>
            <span className="text-xs text-muted hidden md:inline ml-1">Ctrl-click to add · Shift-click for a range</span>
            <div className="flex-1" />
            <button
              onClick={() => usePlayerStore.getState().addToQueue(tracks.filter((t) => selection.has(t.id)))}
              className="h-8 px-3 rounded-full font-semibold hover:bg-surface-2 transition-colors"
            >
              Add to queue
            </button>
            {signedIn && (
              <button
                onClick={() => openEditor(selectedIds)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full font-semibold hover:bg-surface-2 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {signedIn && vaultSelected > 0 && (
              <button
                onClick={() => void deleteSelectedFromVault()}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full font-semibold text-danger hover:bg-danger/10 transition-colors"
              >
                <CloudOff className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            <button
              onClick={() => setSelection(new Set())}
              title="Clear selection"
              className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-2"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {padTop > 0 && <div style={{ height: padTop }} />}
      {rows}
      {padBottom > 0 && <div style={{ height: padBottom }} />}
    </div>
  );

  const menuEl = menu;

  if (!draggable) {
    return (
      <>
        {list}
        {menuEl}
      </>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {list}
      </SortableContext>
      {menuEl}
    </DndContext>
  );
}
