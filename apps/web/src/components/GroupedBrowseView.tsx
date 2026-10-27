import { useMemo } from "react";
import { motion } from "motion/react";
import { useLibraryStore } from "../store/libraryStore";
import { useUiStore } from "../store/uiStore";
import {
  collectionKey,
  computeSmartGroups,
  formatDurationLong,
  smartDef,
  type CollectionKind,
  type SmartGroup,
  type SmartKey,
} from "@musicvault/core";
import { TrackCollection } from "./TrackCollection";
import { Hero, PlayShuffleButtons, ViewHeader } from "./ViewHeader";
import { CardGrid, CardPlayButton, cardMotion } from "./AlbumCard";
import { Mosaic } from "./Mosaic";
import { ArtistAvatar } from "./ArtistAvatar";
import { artKeyOf } from "./AlbumArt";
import { DownloadAllButton } from "./DownloadAllButton";
import { NotFound } from "./NotFound";
import { CardCoverButton, CollectionCoverButton, useCoverContextMenu } from "./CollectionCoverMenu";
import type { Track } from "../types";

/**
 * "By Artist / Genre / Year / Language / Country": a card per group; opening one shows
 * its songs. Artists open their artist page instead.
 */
export function GroupedBrowseView({ smartKey }: { smartKey: SmartKey }) {
  const tracks = useLibraryStore((s) => s.tracks);
  const activeGroup = useUiStore((s) => s.activeGroup);
  const showGroup = useUiStore((s) => s.showGroup);
  const showArtist = useUiStore((s) => s.showArtist);
  const def = smartDef(smartKey);

  const groups = useMemo(() => computeSmartGroups(smartKey, tracks), [smartKey, tracks]);

  if (activeGroup !== null) {
    const group = groups.find((g) => g.name === activeGroup);
    if (!group) return <NotFound what={def.label.replace(/^By /, "")} />;
    const total = group.tracks.reduce((sum, t) => sum + t.duration, 0);
    return (
      <div className="h-full overflow-y-auto">
        <Hero
          kind={def.label.replace(/^By /, "")}
          title={group.name}
          artTrack={group.tracks.find((t) => artKeyOf(t))}
          cover={
            <Mosaic
              tracks={group.tracks}
              collection={collectionKey(smartKey as CollectionKind, group.name)}
              full
              className="w-48 h-48 md:w-56 md:h-56 rounded-xl"
            />
          }
          meta={`${group.tracks.length} ${group.tracks.length === 1 ? "song" : "songs"} • ${formatDurationLong(total)}`}
          actions={
            <>
              <PlayShuffleButtons tracks={group.tracks} />
              <DownloadAllButton tracks={group.tracks} />
              <CollectionCoverButton collection={collectionKey(smartKey as CollectionKind, group.name)} />
            </>
          }
        />
        <TrackCollection page={`group.${smartKey}`} tracks={group.tracks} />
      </div>
    );
  }

  const isArtist = smartKey === "artist";

  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader
        title={def.label}
        subtitle={groups.length > 0 ? `${groups.length} ${isArtist ? "artists" : "groups"}` : undefined}
      />
      <div className="px-6 md:px-8 pb-10">
        {groups.length === 0 ? (
          <p className="text-sm text-muted py-10 text-center">{def.emptyMessage}</p>
        ) : (
          <CardGrid min={isArtist ? 150 : 168}>
            {groups.map((group, i) =>
              isArtist ? (
                <motion.button
                  key={group.name}
                  {...cardMotion(i)}
                  onClick={() => showArtist(group.name)}
                  className="group min-w-0 text-center"
                >
                  <div className="relative overflow-hidden mb-3 rounded-full">
                    <ArtistAvatar
                      name={group.name}
                      track={group.tracks.find((t) => artKeyOf(t))}
                      className="w-full aspect-square transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  </div>
                  <div className="text-sm font-semibold truncate">{group.name}</div>
                  <div className="text-xs text-muted truncate mt-0.5">
                    {group.tracks.length} {group.tracks.length === 1 ? "song" : "songs"}
                  </div>
                </motion.button>
              ) : (
                <GroupCard
                  key={group.name}
                  group={group}
                  index={i}
                  collection={collectionKey(smartKey as CollectionKind, group.name)}
                  onOpen={() => showGroup(smartKey, group.name)}
                />
              ),
            )}
          </CardGrid>
        )}
      </div>
    </div>
  );
}

/** A group's card; right-click or its hover "⋯" changes the cover without opening it. */
function GroupCard({
  group,
  index,
  collection,
  onOpen,
}: {
  group: SmartGroup<Track>;
  index: number;
  collection: string;
  onOpen: () => void;
}) {
  const context = useCoverContextMenu(collection);
  return (
    <>
      <motion.button
        {...cardMotion(index)}
        onClick={onOpen}
        onContextMenu={context.onContextMenu}
        className="group min-w-0 text-left"
      >
        <div className="relative overflow-hidden mb-3 rounded-xl">
          <Mosaic
            tracks={group.tracks}
            collection={collection}
            className="w-full aspect-square transition-transform duration-500 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200" />
          <CardPlayButton tracks={group.tracks} />
          <CardCoverButton collection={collection} />
        </div>
        <div className="text-sm font-semibold truncate">{group.name}</div>
        <div className="text-xs text-muted truncate mt-0.5">
          {group.tracks.length} {group.tracks.length === 1 ? "song" : "songs"}
        </div>
      </motion.button>
      {context.menu}
    </>
  );
}
