import { useRef, useState } from "react";
import { ImagePlus, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { useArtistPhotoStore } from "../store/artistPhotoStore";
import { useAuthStore } from "../store/authStore";
import { emitAppError } from "../lib/errorBus";
import { pickImage } from "../lib/pickImage";
import { uploadCover } from "./TrackEditor";
import { IconButton } from "./ui/Button";
import { Menu, anchorFromElement, type MenuAnchor } from "./ui/Menu";

/** The artist page's "⋯" menu: choose, change or remove the artist's photo (signed in only). */
export function ArtistPhotoMenu({ artist }: { artist: string }) {
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  const photo = useArtistPhotoStore((s) => s.photos[artist]);
  const setPhoto = useArtistPhotoStore((s) => s.setPhoto);
  const [busy, setBusy] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  if (!signedIn) return null;

  const choose = async () => {
    try {
      const cover = await pickImage();
      if (!cover) return;
      setBusy(true);
      setPhoto(artist, await uploadCover(cover));
    } catch (err) {
      emitAppError(`Couldn't set the photo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton
        ref={button}
        label={busy ? "Uploading photo" : "More"}
        size="md"
        disabled={busy}
        onClick={() => button.current && setAnchor(anchorFromElement(button.current))}
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <MoreHorizontal className="w-5 h-5" />}
      </IconButton>
      <Menu
        anchor={anchor}
        onClose={() => setAnchor(null)}
        items={[
          { label: photo ? "Change photo" : "Choose photo", icon: <ImagePlus />, onSelect: () => void choose() },
          ...(photo ? [{ label: "Remove photo", icon: <Trash2 />, onSelect: () => setPhoto(artist, null) }] : []),
        ]}
      />
    </>
  );
}
