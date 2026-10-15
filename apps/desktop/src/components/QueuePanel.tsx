import { useEffect, useRef } from "react";
import { BrushCleaning, GripVertical, Pause, Play, X } from "lucide-react";
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
import type { Track } from "../types";
import { usePlayerStore } from "../store/playerStore";
import { AlbumArt } from "./AlbumArt";
import { formatDurationLong, formatTime } from "@musicvault/core";
import { PanelHeader } from "./PanelHeader";
import { NowPlayingBars } from "./NowPlayingBars";

// Sortable ids include the index so a track appearing twice in the queue
// still gets a unique id.
const rowId = (track: Track, index: number) => `${track.id}::${index}`;

function QueueRow({ track, index, rowRef }: { track: Track; index: number; rowRef?: React.Ref<HTMLDivElement> }) {
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowId(track, index),
  });

  const isCurrent = index === currentIndex;
  const isPast = index < currentIndex;

  const handleClick = () => {
    if (isCurrent) togglePlay();
    else jumpTo(index);
  };

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        if (typeof rowRef === "function") rowRef(el);
        else if (rowRef) (rowRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-center gap-3 mx-2 px-2 h-14 rounded-lg transition-colors ${
        isCurrent ? "bg-accent-soft" : "hover:bg-surface-2"
      } ${isDragging ? "relative z-10 bg-surface-3 shadow-xl" : ""} ${isPast ? "opacity-55 hover:opacity-100" : ""}`}
    >
      <button onClick={handleClick} className="relative shrink-0 rounded-md overflow-hidden">
        <AlbumArt track={track} thumb className="w-10 h-10 rounded-md object-cover" />
        <span
          className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${
            isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {isCurrent ? (
            <span className="group-hover:hidden">
              <NowPlayingBars playing={isPlaying} />
            </span>
          ) : null}
          <span className={isCurrent ? "hidden group-hover:block" : ""}>
            {isCurrent && isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          </span>
        </span>
      </button>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={handleClick}>
        <div className={`truncate text-sm font-medium ${isCurrent ? "text-accent" : ""}`}>{track.title}</div>
        <div className="truncate text-xs text-muted">{track.artist}</div>
      </div>
      <span className="text-xs text-muted tabular-nums shrink-0 group-hover:hidden">{formatTime(track.duration)}</span>
      <div className="hidden group-hover:flex items-center shrink-0">
        <button
          onClick={() => removeFromQueue(index)}
          title="Remove from queue"
          className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-surface-3"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          {...attributes}
          {...listeners}
          className="w-7 h-7 rounded-full flex items-center justify-center touch-none cursor-grab active:cursor-grabbing text-muted hover:text-fg"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function QueuePanel({ variant = "panel" }: { variant?: "panel" | "stage" }) {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const currentRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = queue.map(rowId);
  const remaining = queue.slice(currentIndex + 1).reduce((sum, t) => sum + t.duration, 0);

  // Open with the playing song in view.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(String(active.id));
    const toIndex = ids.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    reorderQueue(fromIndex, toIndex);
  };

  const clearButton = queue.length > 0 && (
    <button
      onClick={clearQueue}
      title="Clear queue"
      className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold text-muted hover:text-fg hover:bg-surface-2 transition-colors"
    >
      <BrushCleaning className="w-4 h-4" /> Clear
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {variant === "panel" ? (
        <PanelHeader title="Queue">{clearButton}</PanelHeader>
      ) : (
        <div className="flex items-center justify-between px-4 pb-2">
          <p className="text-xs text-muted">
            {queue.length > 0
              ? `${queue.length - currentIndex - 1} up next · ${formatDurationLong(remaining)}`
              : "Queue is empty"}
          </p>
          {clearButton}
        </div>
      )}
      <div className="flex-1 overflow-y-auto pb-3">
        {queue.length === 0 && (
          <div className="px-5 py-10 text-center">
            <p className="font-semibold">Your queue is empty</p>
            <p className="text-sm text-muted mt-1">Play a song, or use “Add to queue” from any song’s menu.</p>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {queue.map((track, i) => (
              <div key={rowId(track, i)}>
                {i === currentIndex + 1 && (
                  <div className="px-4 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-subtle">Up next</div>
                )}
                <QueueRow track={track} index={i} rowRef={i === currentIndex ? currentRef : undefined} />
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
