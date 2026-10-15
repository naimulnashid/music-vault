import { Check } from "lucide-react";
import type { Track } from "../types";
import { useIsPinned, useTrackDownload } from "../lib/trackState";

/**
 * Per-song download state: a filling ring while the audio downloads, a small
 * badge once it's kept on this device, nothing otherwise.
 */
export function DownloadRing({ track, size = 18 }: { track: Track; size?: number }) {
  const progress = useTrackDownload(track);
  const pinned = useIsPinned(track);

  if (progress && progress.total > 0 && progress.downloaded < progress.total) {
    const ratio = progress.downloaded / progress.total;
    return <ProgressRing ratio={ratio} size={size} title={`Downloading ${Math.floor(ratio * 100)}%`} />;
  }
  if (pinned) {
    return (
      <span
        title="Downloaded to this device"
        className="shrink-0 rounded-full bg-accent text-accent-fg flex items-center justify-center"
        style={{ width: size - 2, height: size - 2, margin: 1 }}
      >
        <Check className="w-3 h-3" strokeWidth={3.5} />
      </span>
    );
  }
  return <span className="shrink-0" style={{ width: size }} />;
}

export function ProgressRing({ ratio, size = 18, title }: { ratio: number; size?: number; title?: string }) {
  const stroke = size > 30 ? 4 : 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-fg/15" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, ratio)))}
        className="stroke-accent transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}
