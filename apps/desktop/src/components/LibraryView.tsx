import { useMemo } from "react";
import { Library, UploadCloud } from "lucide-react";
import { formatDurationLong } from "@musicvault/core";
import { useLibraryStore, type SortKey } from "../store/libraryStore";
import { useUploadStore } from "../store/uploadStore";
import { useAuthStore } from "../store/authStore";
import { TrackList } from "./TrackList";
import { PlayShuffleButtons, ViewHeader } from "./ViewHeader";
import { Button } from "./ui/Button";
import { Chips } from "./ui/Chips";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "title", label: "Title" },
];

export function LibraryView() {
  const tracks = useLibraryStore((s) => s.tracks);
  const sortKey = useLibraryStore((s) => s.sortKey);
  const setSortKey = useLibraryStore((s) => s.setSortKey);
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  const openUpload = useUploadStore((s) => s.openWith);

  const total = useMemo(() => tracks.reduce((sum, t) => sum + t.duration, 0), [tracks]);

  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader
        title="Library"
        subtitle={tracks.length > 0 ? `${tracks.length} ${tracks.length === 1 ? "song" : "songs"} • ${formatDurationLong(total)}` : undefined}
      >
        {tracks.length > 0 && (
          <div className="flex items-center gap-2">
            <PlayShuffleButtons tracks={tracks} />
          </div>
        )}
      </ViewHeader>
      {tracks.length > 0 && (
        <div className="px-6 md:px-8 pb-3">
          <Chips label="Sort by" options={SORTS} value={sortKey} onChange={setSortKey} />
        </div>
      )}
      {tracks.length === 0 ? (
        <EmptyLibrary signedIn={signedIn} onUpload={() => openUpload()} />
      ) : (
        <TrackList tracks={tracks} />
      )}
    </div>
  );
}

function EmptyLibrary({ signedIn, onUpload }: { signedIn: boolean; onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-20">
      <div className="w-20 h-20 rounded-3xl bg-accent-soft text-accent flex items-center justify-center mb-5">
        <Library className="w-9 h-9" />
      </div>
      <h2 className="text-xl font-bold">Your library is empty</h2>
      <p className="text-sm text-muted mt-2 max-w-sm">
        {signedIn
          ? "Upload songs to your vault — or drop music files anywhere on this window."
          : "Sign in (top right) to see the music in your vault."}
      </p>
      {signedIn && (
        <Button variant="primary" size="lg" className="mt-6" onClick={onUpload} icon={<UploadCloud className="w-4 h-4" />}>
          Upload music
        </Button>
      )}
    </div>
  );
}
