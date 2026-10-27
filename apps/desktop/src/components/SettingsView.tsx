import type { ReactNode } from "react";
import { Bell, DatabaseBackup, FolderOpen, Minus, Plus, RefreshCw, ZoomIn } from "lucide-react";
import { useBackupStore, type BackupPhase } from "../store/backupStore";
import { useAuthStore } from "../store/authStore";
import { useZoomStore, zoomPercent, ZOOM_STEPS } from "../store/zoomStore";
import { ViewHeader } from "./ViewHeader";
import { NotificationToggle } from "./NotificationToggle";
import { Button, IconButton } from "./ui/Button";

function Section({ icon: Icon, title, children }: { icon: typeof Bell; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface border border-line p-5">
      <h2 className="flex items-center gap-2 font-bold mb-3">
        <Icon className="w-5 h-5 text-muted" />
        {title}
      </h2>
      {children}
    </section>
  );
}

const PHASE_LABEL: Record<BackupPhase, string> = {
  music: "Writing songs",
  covers: "Copying covers and artist photos",
  database: "Saving the database",
};

/** Backup Music Vault: songs, covers, artist photos and database rows in one folder on this PC. */
function BackupSection() {
  const dir = useBackupStore((s) => s.dir);
  const running = useBackupStore((s) => s.running);
  const summary = useBackupStore((s) => s.summary);
  const problem = useBackupStore((s) => s.problem);
  const lastRun = useBackupStore((s) => s.lastRun);
  const chooseDir = useBackupStore((s) => s.chooseDir);
  const turnOff = useBackupStore((s) => s.turnOff);
  const runNow = useBackupStore((s) => s.runNow);
  const signedIn = useAuthStore((s) => s.status === "signedIn");

  return (
    <Section icon={DatabaseBackup} title="Backup Music Vault">
      <p className="text-sm text-muted max-w-2xl">
        Keeps a full copy of your vault in a folder on this PC, so nothing is lost if the cloud database or storage is:
        every song as a tagged file in <span className="text-fg">Music</span>, every cover in{" "}
        <span className="text-fg">Covers</span>, artist photos in <span className="text-fg">Artist photos</span>, and your
        songs' details, playlists, favourites, play history and settings as JSON in{" "}
        <span className="text-fg">Database</span>. It updates itself after each sync and only writes what changed.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          {dir ? (
            <div className="text-sm truncate" title={dir}>
              {dir}
            </div>
          ) : (
            <div className="text-sm text-muted">{signedIn ? "No folder chosen." : "Sign in to back up your vault."}</div>
          )}
        </div>
        {dir && (
          <>
            <Button
              variant="secondary"
              onClick={() => void runNow()}
              disabled={running !== null || !signedIn}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Back up now
            </Button>
            <Button variant="secondary" onClick={() => void turnOff()} title="Stop updating the folder. Its files stay.">
              Turn off
            </Button>
          </>
        )}
        <Button
          variant={dir ? "secondary" : "primary"}
          onClick={() => void chooseDir()}
          disabled={running !== null || !signedIn}
          icon={<FolderOpen className="w-4 h-4" />}
          title={dir ? "Back up into another folder. This one is left as it is." : undefined}
        >
          {dir ? "Change folder" : "Choose folder"}
        </Button>
      </div>
      {dir && running && (
        <>
          <div className="mt-4 h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: running.total > 0 ? `${Math.min(100, (running.done / running.total) * 100)}%` : "100%" }}
            />
          </div>
          <p className="text-xs text-muted mt-3 tabular-nums">
            {PHASE_LABEL[running.phase]}
            {running.total > 0 && ` · ${running.done.toLocaleString()} of ${running.total.toLocaleString()}`}
          </p>
        </>
      )}
      {dir && !running && problem && <p className="text-xs text-danger mt-3">{problem}</p>}
      {dir && !running && !problem && summary && (
        <p className="text-xs text-muted mt-3">
          {summary}
          {lastRun && ` · last finished ${new Date(lastRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </p>
      )}
    </Section>
  );
}

function ZoomSection() {
  const zoom = useZoomStore((s) => s.zoom);
  const zoomIn = useZoomStore((s) => s.zoomIn);
  const zoomOut = useZoomStore((s) => s.zoomOut);
  const reset = useZoomStore((s) => s.reset);
  return (
    <Section icon={ZoomIn} title="Zoom">
      <div className="flex items-center gap-3">
        <IconButton label="Zoom out (Ctrl+minus)" size="md" onClick={zoomOut} disabled={zoom <= ZOOM_STEPS[0]}>
          <Minus className="w-5 h-5" />
        </IconButton>
        <span className="w-14 text-center text-lg font-semibold tabular-nums">{zoomPercent(zoom)}</span>
        <IconButton label="Zoom in (Ctrl+plus)" size="md" onClick={zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
          <Plus className="w-5 h-5" />
        </IconButton>
        <Button variant="secondary" onClick={reset} disabled={zoom === 1}>
          Reset
        </Button>
      </div>
    </Section>
  );
}

export function SettingsView() {
  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader title="Settings" />
      <div className="px-6 md:px-8 pb-10 space-y-6 max-w-4xl">
        <BackupSection />
        <Section icon={Bell} title="Notifications">
          <div className="-mx-4 max-w-md">
            <NotificationToggle />
          </div>
        </Section>
        <ZoomSection />
      </div>
    </div>
  );
}
