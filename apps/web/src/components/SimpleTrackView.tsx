import type { ReactNode } from "react";
import { formatDurationLong, type SmartKey } from "@musicvault/core";
import type { Track } from "../types";
import { TrackCollection } from "./TrackCollection";
import { Hero, PlayShuffleButtons } from "./ViewHeader";
import { SMART_GRADIENTS, SMART_ICONS } from "./smartIcons";
import { DownloadAllButton } from "./DownloadAllButton";
import { artKeyOf } from "./AlbumArt";

interface SimpleTrackViewProps {
  title: string;
  tracks: Track[];
  emptyMessage: string;
  action?: ReactNode;
  /** Built-in smart collection this view shows (picks the cover tile). */
  smartKey: SmartKey;
}

/** Hero + song list for the built-in smart collections (Favorites, Most Played, …). */
export function SimpleTrackView({ title, tracks, emptyMessage, action, smartKey }: SimpleTrackViewProps) {
  const Icon = SMART_ICONS[smartKey];
  const total = tracks.reduce((sum, t) => sum + t.duration, 0);
  return (
    <div className="h-full overflow-y-auto">
      <Hero
        kind="Smart playlist"
        title={title}
        artTrack={tracks.find((t) => artKeyOf(t))}
        cover={
          <div
            className={`w-48 h-48 md:w-56 md:h-56 rounded-xl bg-gradient-to-br ${SMART_GRADIENTS[smartKey]} flex items-center justify-center text-white`}
          >
            <Icon className="w-1/3 h-1/3" strokeWidth={1.6} />
          </div>
        }
        meta={tracks.length > 0 ? `${tracks.length} ${tracks.length === 1 ? "song" : "songs"} • ${formatDurationLong(total)}` : "Updates automatically"}
        actions={
          tracks.length > 0 ? (
            <>
              <PlayShuffleButtons tracks={tracks} />
              <DownloadAllButton tracks={tracks} />
              {action}
            </>
          ) : undefined
        }
      />
      {tracks.length === 0 ? (
        <p className="text-sm text-muted px-8 py-10 text-center">{emptyMessage}</p>
      ) : (
        <TrackCollection page={`smart.${smartKey}`} tracks={tracks} />
      )}
    </div>
  );
}
