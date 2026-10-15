import { SearchX } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { Button } from "./ui/Button";

/** Shown when a page's album/artist/playlist no longer exists (deleted, renamed). */
export function NotFound({ what }: { what: string }) {
  const showTracks = useUiStore((s) => s.showTracks);
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 text-muted">
      <SearchX className="w-12 h-12 mb-4 text-subtle" strokeWidth={1.5} />
      <p className="font-semibold text-fg">{what} not found</p>
      <p className="text-sm mt-1">It may have been renamed or removed.</p>
      <Button className="mt-5" onClick={showTracks}>
        Back to Library
      </Button>
    </div>
  );
}
