import { useEffect, useMemo, useState } from "react";
import { computeRecap, recapYears, systemZone } from "@musicvault/core";
import { useStatsStore } from "../store/statsStore";
import { formatHours } from "./StatsView";
import { ViewHeader } from "./ViewHeader";
import { Chips } from "./ui/Chips";
import { useChartTooltip } from "./ChartTooltip";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

/** Yearly "Wrapped"-style recap built from the play-event stream. */
export function RecapView() {
  const events = useStatsStore((s) => s.events);
  const metaById = useStatsStore((s) => s.metaById);
  const load = useStatsStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const zone = useMemo(() => systemZone(), []);
  const years = useMemo(() => recapYears(events, zone), [events, zone]);
  const [year, setYear] = useState<number | null>(null);
  const tip = useChartTooltip();
  const activeYear = year ?? years[0] ?? new Date().getFullYear();

  const recap = useMemo(
    () => computeRecap(events, metaById, zone, activeYear),
    [events, metaById, zone, activeYear],
  );

  const maxMonth = Math.max(1, ...recap.monthlySeconds);
  const topTrack = recap.topTracks[0];
  const topArtist = recap.topArtists[0];

  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader title={`Your ${activeYear} Recap`} subtitle="The year in music">
        {years.length > 1 && (
          <Chips
            options={years.map((y) => ({ key: String(y), label: String(y) }))}
            value={String(activeYear)}
            onChange={(y) => setYear(Number(y))}
          />
        )}
      </ViewHeader>

      <div className="pb-8">
        {recap.plays === 0 ? (
          <div className="p-6">
            <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
              No listening recorded in {activeYear} yet. Your recap grows as you play.
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
            {/* Hero */}
            <div
              className="rounded-2xl p-8 text-white"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 40%, #1e1b4b) 100%)",
              }}
            >
              <div className="text-sm uppercase tracking-widest opacity-80 mb-2">Minutes listened</div>
              <div className="text-5xl md:text-6xl font-bold tabular-nums">
                {Math.round(recap.listenSeconds / 60).toLocaleString()}
              </div>
              <div className="mt-4 text-sm opacity-90">
                {recap.plays.toLocaleString()} plays · {recap.uniqueTracks} tracks · {recap.uniqueArtists} artists ·{" "}
                {recap.activeDays} days of music
              </div>
            </div>

            {/* Spotlights */}
            <div className="grid md:grid-cols-2 gap-4">
              {topArtist && (
                <div className="rounded-xl border border-line bg-surface p-6">
                  <div className="text-xs uppercase tracking-wide text-muted mb-2">Top Artist</div>
                  <div className="text-2xl font-semibold truncate">{topArtist.name}</div>
                  <div className="text-sm text-muted mt-1">
                    {formatHours(topArtist.listenSeconds)} · {topArtist.plays} plays
                  </div>
                </div>
              )}
              {topTrack && (
                <div className="rounded-xl border border-line bg-surface p-6">
                  <div className="text-xs uppercase tracking-wide text-muted mb-2">Top Track</div>
                  <div className="text-2xl font-semibold truncate">{topTrack.title}</div>
                  <div className="text-sm text-muted mt-1 truncate">
                    {topTrack.artist} · {formatHours(topTrack.listenSeconds)} · {topTrack.plays} plays
                  </div>
                </div>
              )}
            </div>

            {/* Fun facts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-line bg-surface p-4">
                <div className="text-lg font-semibold">{recap.longestStreak} days</div>
                <div className="text-xs text-muted">Longest streak</div>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <div className="text-lg font-semibold">{recap.peakDay ? recap.peakDay.key : "—"}</div>
                <div className="text-xs text-muted">
                  Biggest day{recap.peakDay ? ` · ${formatHours(recap.peakDay.listenSeconds)}` : ""}
                </div>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <div className="text-lg font-semibold">
                  {recap.mostActiveHour !== null ? hourLabel(recap.mostActiveHour) : "—"}
                </div>
                <div className="text-xs text-muted">Favourite hour</div>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <div className="text-lg font-semibold truncate">{recap.topGenres[0]?.name ?? "—"}</div>
                <div className="text-xs text-muted">Top genre</div>
              </div>
            </div>

            {/* Month-by-month */}
            <div className="rounded-xl border border-line bg-surface p-6">
              <div className="text-xs uppercase tracking-wide text-muted mb-4">Your year, month by month</div>
              <div className="flex items-end gap-2 h-28">
                {recap.monthlySeconds.map((seconds, i) => (
                  <div
                    key={i}
                    className="group flex-1 flex flex-col items-center gap-1"
                    {...tip.bind(`${MONTHS[i]} · ${seconds > 0 ? formatHours(seconds) : "no listening"}`)}
                  >
                    <div
                      data-tip-anchor
                      className="w-full rounded-t bg-accent/70 group-hover:bg-accent transition-colors"
                      style={{ height: `${Math.max(seconds > 0 ? 4 : 0, (seconds / maxMonth) * 100)}%` }}
                    />
                    <span className="text-xs text-muted">{MONTHS[i]}</span>
                  </div>
                ))}
              </div>
              {tip.node}
            </div>

            {/* Top 5 lists */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-line bg-surface p-6">
                <div className="text-xs uppercase tracking-wide text-muted mb-3">Top Tracks</div>
                <ol className="space-y-2">
                  {recap.topTracks.map((t, i) => (
                    <li key={t.trackId} className="flex items-center gap-3 text-sm">
                      <span className="w-5 text-right text-muted tabular-nums">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{t.title}</div>
                        <div className="truncate text-xs text-muted">{t.artist}</div>
                      </div>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {formatHours(t.listenSeconds)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-xl border border-line bg-surface p-6">
                <div className="text-xs uppercase tracking-wide text-muted mb-3">Top Artists</div>
                <ol className="space-y-2">
                  {recap.topArtists.map((a, i) => (
                    <li key={a.name} className="flex items-center gap-3 text-sm">
                      <span className="w-5 text-right text-muted tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {formatHours(a.listenSeconds)} · {a.plays}×
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
