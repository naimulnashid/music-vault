import { useRef, useState } from "react";
import { ImagePlus, Loader2, MoreHorizontal, RotateCcw } from "lucide-react";
import { useCollectionCoverStore } from "../store/collectionCoverStore";
import { useAuthStore } from "../store/authStore";
import { emitAppError } from "../lib/errorBus";
import { pickImage } from "../lib/pickImage";
import { uploadCover } from "./TrackEditor";
import { IconButton } from "./ui/Button";
import { Menu, anchorFromElement, type MenuAnchor, type MenuItem } from "./ui/Menu";

/**
 * "Change cover" / "Use default cover" for a playlist or group (signed in
 * only, as covers live in the vault). Used by its page and by every place
 * that lists it, so a cover can be changed without opening it.
 */
export function useCoverMenuItems(collection: string): MenuItem[] {
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  const cover = useCollectionCoverStore((s) => s.covers[collection]);
  const setCover = useCollectionCoverStore((s) => s.setCover);
  const setUploading = useCollectionCoverStore((s) => s.setUploading);
  if (!signedIn) return [];

  const choose = async () => {
    try {
      const picked = await pickImage();
      if (!picked) return;
      setUploading(collection, true);
      setCover(collection, await uploadCover(picked));
    } catch (err) {
      emitAppError(`Couldn't set the cover: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(collection, false);
    }
  };

  return [
    {
      label: cover ? "Change cover" : "Choose cover",
      icon: <ImagePlus />,
      onSelect: () => void choose(),
    },
    ...(cover
      ? [
          {
            label: "Use default cover",
            icon: <RotateCcw />,
            onSelect: () => setCover(collection, null),
          },
        ]
      : []),
  ];
}

/** A right-click menu holding only the cover items, for cards and list rows. */
export function useCoverContextMenu(collection: string) {
  const items = useCoverMenuItems(collection);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return {
    onContextMenu: (e: React.MouseEvent) => {
      if (items.length === 0) return;
      e.preventDefault();
      setAnchor({ x: e.clientX, y: e.clientY });
    },
    menu: <Menu anchor={anchor} onClose={() => setAnchor(null)} items={items} />,
  };
}

/** The "⋯" button on a group's page and on hovered group cards. */
export function CollectionCoverButton({ collection, className = "" }: { collection: string; className?: string }) {
  const items = useCoverMenuItems(collection);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const busy = useCollectionCoverStore((s) => s.uploading.includes(collection));
  if (items.length === 0) return null;
  return (
    <>
      <IconButton
        ref={button}
        label={busy ? "Uploading cover" : "More"}
        size="md"
        disabled={busy}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          if (button.current) setAnchor(anchorFromElement(button.current));
        }}
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <MoreHorizontal className="w-5 h-5" />}
      </IconButton>
      <Menu anchor={anchor} onClose={() => setAnchor(null)} items={items} />
    </>
  );
}

/**
 * The hover "⋯" on a card, a span like CardPlayButton so it can sit inside
 * the card's own button. Right-click on the card opens the same menu.
 */
export function CardCoverButton({ collection }: { collection: string }) {
  const items = useCoverMenuItems(collection);
  const busy = useCollectionCoverStore((s) => s.uploading.includes(collection));
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <span
        role="button"
        tabIndex={-1}
        title={busy ? "Uploading cover" : "Cover"}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchorFromElement(e.currentTarget));
        }}
        className={`absolute right-2 top-2 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center transition-opacity duration-200 hover:bg-black/75 ${
          busy || anchor ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
      </span>
      {/* The menu is portalled, but its clicks still bubble through React to the card. */}
      <span className="contents" onClick={(e) => e.stopPropagation()}>
        <Menu anchor={anchor} onClose={() => setAnchor(null)} items={items} />
      </span>
    </>
  );
}
