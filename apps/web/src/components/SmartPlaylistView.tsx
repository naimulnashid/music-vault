import { useMemo } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { useHistoryStore } from "../store/historyStore";
import { computeSmartTracks, smartDef, type SmartKey } from "@musicvault/core";
import { SimpleTrackView } from "./SimpleTrackView";
import { Button } from "./ui/Button";

export function SmartPlaylistView({ smartKey }: { smartKey: SmartKey }) {
  const tracks = useLibraryStore((s) => s.tracks);
  const recentIds = useHistoryStore((s) => s.recentIds);
  const playCounts = useHistoryStore((s) => s.playCounts);
  const clear = useHistoryStore((s) => s.clear);

  const def = smartDef(smartKey);
  const result = useMemo(
    () => computeSmartTracks(smartKey, tracks, { recentIds, playCounts }),
    [smartKey, tracks, recentIds, playCounts],
  );

  return (
    <SimpleTrackView
      title={def.label}
      smartKey={smartKey}
      tracks={result}
      emptyMessage={def.emptyMessage}
      action={
        smartKey === "recentlyPlayed" && result.length > 0 ? (
          <Button variant="ghost" size="lg" onClick={() => clear()}>
            Clear history
          </Button>
        ) : undefined
      }
    />
  );
}
