import { useEffect, useMemo, useRef, useState } from "react";
import { CloudDownload, Download, FolderOpen, HardDrive, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useDownloadStore } from "../store/downloadStore";
import { useLibraryStore } from "../store/libraryStore";
import type { Track } from "../types";
import { ViewHeader } from "./ViewHeader";
import { TrackCollection } from "./TrackCollection";
import { AlbumArt } from "./AlbumArt";
import { ProgressRing } from "./DownloadRing";
import { Button } from "./ui/Button";
import { Toggle } from "./ui/Toggle";
import { useCollectionDownload } from "../lib/trackState";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 ** 2) return `${(bytesPerSec / 1024 ** 2).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

/** 0 turns the auto-cache off; 10 GB is the most it may use. */
const CACHE_CAP_CHOICES_GB = [0, 1, 2, 5, 10];

/** Explicit downloads + auto-cache management (Phase 3, plan item 7). */
export function DownloadsView() {
  const cacheEntries = useDownloadStore((s) => s.cacheEntries);
  const cacheStats = useDownloadStore((s) => s.cacheStats);
  const downloadProgress = useDownloadStore((s) => s.downloadProgress);
  const refreshDownloads = useDownloadStore((s) => s.refreshDownloads);
  const removeDownload = useDownloadStore((s) => s.removeDownload);
  const setCacheMax = useDownloadStore((s) => s.setCacheMax);
  const clearCache = useDownloadStore((s) => s.clearCache);
  const autoDownload = useDownloadStore((s) => s.autoDownload);
  const setAutoDownload = useDownloadStore((s) => s.setAutoDownload);
  const downloadsDir = useDownloadStore((s) => s.downloadsDir);
  const moving = useDownloadStore((s) => s.moving);
  const queuedCount = useDownloadStore((s) => s.queued.size);
  const chooseDownloadsDir = useDownloadStore((s) => s.chooseDownloadsDir);
  const moveDownloadsTo = useDownloadStore((s) => s.moveDownloadsTo);
  const tracks = useLibraryStore((s) => s.tracks);
  const library = useCollectionDownload(tracks);

  useEffect(() => {
    void refreshDownloads();
  }, [refreshDownloads]);

  // Live aggregate speed: sample each active file's cumulative bytes once a
  // second and sum the per-file rates. Summing rates (rather than diffing the
  // total) means a file finishing and dropping out of the set doesn't show up
  // as a negative blip.
  const [speed, setSpeed] = useState(0); // bytes/sec
  const lastSamples = useRef(new Map<string, { bytes: number; t: number }>());
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      const progress = useDownloadStore.getState().downloadProgress;
      const entries = Object.entries(progress);
      if (entries.length === 0) {
        lastSamples.current.clear();
        setSpeed(0);
        return;
      }
      let rate = 0;
      const seen = new Set<string>();
      for (const [fileId, p] of entries) {
        seen.add(fileId);
        const prev = lastSamples.current.get(fileId);
        if (prev) {
          const dt = (now - prev.t) / 1000;
          if (dt > 0) rate += Math.max(0, (p.downloaded - prev.bytes) / dt);
        }
        lastSamples.current.set(fileId, { bytes: p.downloaded, t: now });
      }
      for (const fileId of lastSamples.current.keys()) {
        if (!seen.has(fileId)) lastSamples.current.delete(fileId);
      }
      setSpeed(rate);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const trackByFileId = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of tracks) {
      // Downloads are indexed as "vault:<contentHash>".
      if (t.contentHash) map.set(`vault:${t.contentHash}`, t);
    }
    return map;
  }, [tracks]);

  const pinned = cacheEntries.filter((e) => e.pinned);
  const inProgress = Object.entries(downloadProgress);
  const aggDownloaded = inProgress.reduce((sum, [, p]) => sum + p.downloaded, 0);
  const aggTotal = inProgress.reduce((sum, [, p]) => sum + (p.total > 0 ? p.total : 0), 0);

  const label = (fileId: string, fallbackPath?: string) => {
    const t = trackByFileId.get(fileId);
    if (t) return { title: t.title, subtitle: `${t.artist} · ${t.album}` };
    const name = fallbackPath?.split(/[\\/]/).pop() ?? fileId;
    return { title: name, subtitle: "" };
  };

  const pinnedTracks = pinned.map((e) => trackByFileId.get(e.fileId)).filter((t): t is Track => Boolean(t));
  const orphans = pinned.filter((e) => !trackByFileId.has(e.fileId));
  const pinnedBytes = pinned.reduce((sum, e) => sum + e.size, 0);

  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader
        title="Downloads"
        subtitle={`${pinned.length} ${pinned.length === 1 ? "song" : "songs"} on this device • ${formatBytes(pinnedBytes)}`}
      >
        {library.active > 0 ? (
          <Button
            onClick={library.cancel}
            title={`Downloaded ${library.done} of ${library.total}. Click to cancel the rest.`}
            icon={<X className="w-4 h-4" />}
            size="lg"
            variant="secondary"
          >
            Cancel downloads
          </Button>
        ) : (
          <Button
            onClick={library.download}
            disabled={library.done === library.total}
            title="Download every song in your vault to this device"
            icon={<Download className="w-4 h-4" />}
            size="lg"
          >
            Download all
          </Button>
        )}
      </ViewHeader>

      <div className="px-6 md:px-8 pb-6 space-y-6">
        <AnimatePresence initial={false}>
          {inProgress.length > 0 && (
            <motion.section
              key="active"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-2xl bg-surface border border-line p-5">
                <div className="flex items-center gap-4">
                  <ProgressRing ratio={aggTotal > 0 ? aggDownloaded / aggTotal : 0} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">
                      Downloading {inProgress.length} {inProgress.length === 1 ? "song" : "songs"}
                    </div>
                    <div className="text-sm text-muted tabular-nums">
                      {formatBytes(aggDownloaded)}
                      {aggTotal > 0 && ` of ${formatBytes(aggTotal)}`} • {formatSpeed(speed)}
                    </div>
                  </div>
                  <div className="text-2xl font-extrabold tabular-nums">
                    {aggTotal > 0 ? Math.floor((aggDownloaded / aggTotal) * 100) : 0}%
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {inProgress.map(([fileId, p]) => {
                    const { title, subtitle } = label(fileId);
                    const track = trackByFileId.get(fileId) ?? tracks.find((t) => `vault:${t.contentHash}` === fileId);
                    const pct = p.total > 0 ? Math.min(100, (p.downloaded / p.total) * 100) : 0;
                    return (
                      <div key={fileId} className="flex items-center gap-3">
                        <AlbumArt track={track} thumb className="w-10 h-10 rounded-md object-cover shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="truncate font-medium">{track?.title ?? title}</span>
                            <span className="text-xs text-muted shrink-0 tabular-nums">
                              {Math.floor(pct)}% • {formatBytes(p.downloaded)} / {p.total > 0 ? formatBytes(p.total) : "…"}
                            </span>
                          </div>
                          {(track?.artist ?? subtitle) && <div className="text-xs text-muted truncate">{track?.artist ?? subtitle}</div>}
                          <div className="mt-1.5 h-1 rounded-full bg-surface-3 overflow-hidden">
                            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <section className="rounded-2xl bg-surface border border-line p-5">
          <div className="flex items-start gap-3">
            <CloudDownload className="w-5 h-5 text-muted mt-1.5" />
            <div className="flex-1 min-w-0">
              <Toggle
                checked={autoDownload}
                onChange={setAutoDownload}
                label="Download all songs automatically"
                hint="Songs added to your vault download to this PC, and songs deleted from it are removed. No auto-cache is needed while this is on."
              />
              {autoDownload && library.total > 0 && (
                <p className="text-xs text-muted mt-1 tabular-nums">
                  {library.done} of {library.total} songs on this PC
                </p>
              )}
            </div>
          </div>
        </section>

        {cacheStats && !autoDownload && (
          <section className="rounded-2xl bg-surface border border-line p-5">
            <div className="flex flex-wrap items-center gap-3">
              <HardDrive className="w-5 h-5 text-muted" />
              <div className="flex-1 min-w-0">
                <div className="font-bold">Auto-cache</div>
                <div className="text-sm text-muted">
                  {cacheStats.maxBytes === 0
                    ? `Off${cacheStats.autoBytes > 0 ? ` • ${formatBytes(cacheStats.autoBytes)} for the songs playing now` : ""}`
                    : `${formatBytes(cacheStats.autoBytes)} used of ${formatBytes(cacheStats.maxBytes)}`}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                Limit
                <select
                  value={cacheStats.maxBytes}
                  onChange={(e) => void setCacheMax(Number(e.target.value))}
                  className="mv-field w-auto! py-1.5!"
                >
                  {CACHE_CAP_CHOICES_GB.map((gb) => (
                    <option key={gb} value={gb * 1024 ** 3}>
                      {gb === 0 ? "Off" : `${gb} GB`}
                    </option>
                  ))}
                  {!CACHE_CAP_CHOICES_GB.some((gb) => gb * 1024 ** 3 === cacheStats.maxBytes) && (
                    <option value={cacheStats.maxBytes}>{formatBytes(cacheStats.maxBytes)}</option>
                  )}
                </select>
              </label>
              <Button
                variant="secondary"
                onClick={() => void clearCache()}
                disabled={cacheStats.autoBytes === 0}
                icon={<Trash2 className="w-4 h-4" />}
              >
                Clear cache
              </Button>
            </div>
            <div className="mt-4 h-2 rounded-full bg-surface-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, (cacheStats.autoBytes / Math.max(1, cacheStats.maxBytes)) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted mt-3">
              Songs you play are cached automatically; the least recently played leave first when the cache is full.
              Downloads ({formatBytes(cacheStats.pinnedBytes)}) stay until you remove them.
            </p>
          </section>
        )}

        {downloadsDir && (
          <section className="rounded-2xl bg-surface border border-line p-5">
            <div className="flex flex-wrap items-center gap-3">
              <FolderOpen className="w-5 h-5 text-muted" />
              <div className="flex-1 min-w-0">
                <div className="font-bold">Download folder</div>
                <div className="text-sm text-muted truncate" title={downloadsDir.path}>
                  {downloadsDir.path}
                </div>
              </div>
              {downloadsDir.path !== downloadsDir.defaultPath && (
                <Button
                  variant="secondary"
                  onClick={() => void moveDownloadsTo(downloadsDir.defaultPath)}
                  disabled={moving !== null || inProgress.length > 0 || queuedCount > 0}
                  title={`Move the downloads back to ${downloadsDir.defaultPath}`}
                >
                  Use default
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => void chooseDownloadsDir()}
                disabled={moving !== null || inProgress.length > 0 || queuedCount > 0}
                icon={<FolderOpen className="w-4 h-4" />}
              >
                Change folder
              </Button>
            </div>
            {moving ? (
              <>
                <div className="mt-4 h-2 rounded-full bg-surface-3 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${moving.totalBytes > 0 ? Math.min(100, (moving.bytes / moving.totalBytes) * 100) : 0}%` }}
                  />
                </div>
                <p className="text-xs text-muted mt-3 tabular-nums">
                  Moving {moving.done} of {moving.total} {moving.total === 1 ? "download" : "downloads"}
                  {moving.totalBytes > 0 && ` • ${formatBytes(moving.bytes)} of ${formatBytes(moving.totalBytes)}`}
                </p>
              </>
            ) : (
              (inProgress.length > 0 || queuedCount > 0) && (
                <p className="text-xs text-muted mt-3">The folder can be changed once the downloads finish.</p>
              )
            )}
          </section>
        )}
      </div>

      {pinned.length === 0 && <h2 className="px-6 md:px-8 pb-2 text-xl font-bold">On this device</h2>}
      {pinned.length === 0 ? (
        <p className="px-8 pb-10 text-sm text-muted">
          Nothing downloaded yet — choose “Download” on a song, album, artist or playlist.
        </p>
      ) : (
        <>
          <TrackCollection
            page="downloads"
            tracks={pinnedTracks}
            toolbar={<h2 className="text-xl font-bold">On this device</h2>}
          />
          {orphans.map((entry) => {
            const { title } = label(entry.fileId, entry.path);
            return (
              <div key={entry.fileId} className="group flex items-center gap-3 mx-4 px-2 h-14 rounded-lg hover:bg-surface-2">
                <span className="flex-1 truncate text-sm text-muted">{title} (no longer in your vault)</span>
                <span className="text-xs text-muted">{formatBytes(entry.size)}</span>
                <button
                  onClick={() => void removeDownload(entry.fileId)}
                  title="Remove download from this device"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-danger hover:bg-surface-3"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
