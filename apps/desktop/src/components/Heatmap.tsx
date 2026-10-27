import { useEffect, useMemo, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { bucketize, dayKeyOf, systemZone } from "@musicvault/core";
import { useStatsStore } from "../store/statsStore";
import { useUiStore } from "../store/uiStore";
import { ViewHeader } from "./ViewHeader";
import { formatHours } from "./StatsView";
import { useChartTooltip } from "./ChartTooltip";

/**
 * Calendar heatmap of listening time: the last six months on the Statistics
 * page, and every block of six months on the expanded page. Both draw blocks
 * of WEEKS Saturday-first week columns, so the expanded page grows downward
 * and its cells stay the size of the overview's.
 */
const WEEKS = 26;
const DAY_MS = 86_400_000;
const DAY_LABELS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Cell {
  key: string;
  seconds: number;
  /** After today or before the page's first day: not drawn. */
  hidden: boolean;
  column: number;
  row: number;
}

interface Block {
  cells: Cell[];
  months: { label: string; column: number }[];
  /** Epoch days of the first and last drawn day. */
  first: number;
  last: number;
  peak: number;
  total: number;
  activeDays: number;
}

const dateOf = (epochDay: number) => new Date(epochDay * DAY_MS);
const keyOf = (epochDay: number) => {
  const d = dateOf(epochDay);
  return dayKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};
/** Saturday is getUTCDay() 6, so +1 mod 7 puts it on row 0. */
const rowOf = (epochDay: number) => (dateOf(epochDay).getUTCDay() + 1) % 7;
const weekStartOf = (epochDay: number) => epochDay - rowOf(epochDay);

function todayEpochDay(nowMs: number): number {
  const p = systemZone().parts(nowMs);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

function buildBlock(byDay: Map<string, number>, firstWeek: number, today: number, from: number | null): Block {
  const cells: Cell[] = [];
  const months: Block["months"] = [];
  let peak = 0;
  let total = 0;
  let activeDays = 0;
  let lastMonth = -1;
  for (let column = 0; column < WEEKS; column++) {
    const weekStart = firstWeek + column * 7;
    // Label a column by the first day it draws, so a block clipped to 1 January opens on "Jan".
    const month = dateOf(from !== null && weekStart < from ? from : weekStart).getUTCMonth();
    if (month !== lastMonth) {
      months.push({ label: MONTHS[month], column });
      lastMonth = month;
    }
    for (let row = 0; row < 7; row++) {
      const day = weekStart + row;
      const key = keyOf(day);
      const hidden = day > today || (from !== null && day < from);
      const seconds = hidden ? 0 : (byDay.get(key) ?? 0);
      if (seconds > 0) {
        peak = Math.max(peak, seconds);
        total += seconds;
        activeDays++;
      }
      cells.push({ key, seconds, hidden, column, row });
    }
  }
  // A block opening on a month's last week labels it and the next month side by side; drop the stub.
  if (months.length > 1 && months[1].column - months[0].column < 3) months.shift();
  return {
    cells,
    months,
    peak,
    total,
    activeDays,
    first: from !== null && firstWeek < from ? from : firstWeek,
    last: Math.min(today, firstWeek + WEEKS * 7 - 1),
  };
}

/** The WEEKS weeks ending with the current one. */
function recentBlock(byDay: Map<string, number>, today: number): Block {
  return buildBlock(byDay, weekStartOf(today) - (WEEKS - 1) * 7, today, null);
}

/** Every block from 1 January of the first year with listening to today, oldest first. */
function allBlocks(byDay: Map<string, number>, today: number): Block[] {
  const firstKey = [...byDay.keys()].sort()[0] ?? keyOf(today);
  const from = Math.floor(Date.UTC(Number(firstKey.slice(0, 4)), 0, 1) / DAY_MS);
  const blocks: Block[] = [];
  for (let week = weekStartOf(from); week <= today; week += WEEKS * 7) {
    blocks.push(buildBlock(byDay, week, today, from));
  }
  return blocks;
}

/** Uneven steps: a few long days would otherwise wash every normal day into level 1. */
function level(seconds: number, max: number): number {
  if (seconds <= 0 || max <= 0) return 0;
  const r = seconds / max;
  return r > 0.7 ? 4 : r > 0.35 ? 3 : r > 0.15 ? 2 : 1;
}
const LEVEL_MIX = [0, 30, 50, 75, 100];
const levelColor = (l: number) =>
  l === 0
    ? "var(--color-surface-2)"
    : `color-mix(in srgb, var(--color-accent) ${LEVEL_MIX[l]}%, var(--color-surface-2))`;

function HeatmapPlot({ block, max }: { block: Block; max: number }) {
  const tip = useChartTooltip();
  return (
    // Padding leaves room for a hovered cell to grow; overflow-y stays hidden so that
    // growth never adds a scrollbar.
    <div className="overflow-x-auto overflow-y-hidden p-3">
      <div
        className="grid items-center gap-[3px]"
        style={{
          // Fluid columns: the six months always span the full width, cells stay square.
          gridTemplateColumns: `auto repeat(${WEEKS}, minmax(11px, 1fr))`,
          gridTemplateRows: "18px repeat(7, auto)",
        }}
      >
        {block.months.map((m) => (
          <span
            key={`${m.label}-${m.column}`}
            className="self-end whitespace-nowrap text-sm text-muted"
            style={{ gridColumn: m.column + 2, gridRow: 1 }}
          >
            {m.label}
          </span>
        ))}
        {DAY_LABELS.map((d, i) => (
          <span key={d} className="pr-2 text-xs leading-none text-muted" style={{ gridColumn: 1, gridRow: i + 2 }}>
            {d}
          </span>
        ))}
        {block.cells.map((cell) => (
          <span
            key={cell.key}
            className={
              cell.hidden
                ? "invisible"
                : "block aspect-square rounded-[3px] transition-transform duration-150 hover:relative hover:z-10 hover:scale-[1.3] hover:ring-1 hover:ring-fg/50"
            }
            style={{
              gridColumn: cell.column + 2,
              gridRow: cell.row + 2,
              backgroundColor: cell.hidden ? undefined : levelColor(level(cell.seconds, max)),
            }}
            {...(cell.hidden
              ? {}
              : tip.bind(
                  `${cell.key} (${DAY_LABELS[cell.row]}) · ${cell.seconds > 0 ? formatHours(cell.seconds) : "no listening"}`,
                ))}
          />
        ))}
      </div>
      {tip.node}
    </div>
  );
}

function HeatmapLegend({ summary, children }: { summary: string; children?: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-2 text-xs text-muted sm:grid sm:grid-cols-[1fr_auto_1fr]">
      <span>{summary}</span>
      {children ?? <span />}
      <span className="inline-flex items-center gap-1 sm:justify-self-end">
        Less
        {LEVEL_MIX.map((_, l) => (
          <span key={l} className="inline-block w-3 h-3 rounded-[3px]" style={{ backgroundColor: levelColor(l) }} />
        ))}
        More
      </span>
    </div>
  );
}

const activeSummary = (seconds: number, days: number, span: string) =>
  `${formatHours(seconds)} across ${days} active ${days === 1 ? "day" : "days"} ${span}`;

/** byDay keys are dayKeyOf() strings in the system zone. */
export function CalendarHeatmap({ secondsByDay, nowMs }: { secondsByDay: Map<string, number>; nowMs: number }) {
  const showHeatmap = useUiStore((s) => s.showHeatmap);
  const block = useMemo(() => recentBlock(secondsByDay, todayEpochDay(nowMs)), [secondsByDay, nowMs]);
  return (
    <div>
      <HeatmapPlot block={block} max={block.peak} />
      <HeatmapLegend summary={activeSummary(block.total, block.activeDays, "in the last 6 months")}>
        <button
          onClick={showHeatmap}
          className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-fg transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Expand
        </button>
      </HeatmapLegend>
    </div>
  );
}

function blockLabel(block: Block): string {
  const a = dateOf(block.first);
  const b = dateOf(block.last);
  const y1 = a.getUTCFullYear();
  const y2 = b.getUTCFullYear();
  return y1 === y2
    ? `${MONTHS[a.getUTCMonth()]} – ${MONTHS[b.getUTCMonth()]} ${y2}`
    : `${MONTHS[a.getUTCMonth()]} ${y1} – ${MONTHS[b.getUTCMonth()]} ${y2}`;
}

/** The expanded page: all listening history, six months per block, one shared colour scale. */
export function HeatmapView() {
  const events = useStatsStore((s) => s.events);
  const load = useStatsStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  const { blocks, max, total, activeDays } = useMemo(() => {
    const byDay = new Map(bucketize(events, systemZone(), "day").map((b) => [b.key, b.listenSeconds]));
    const all = allBlocks(byDay, todayEpochDay(Date.now()));
    return {
      blocks: all,
      max: Math.max(0, ...all.map((b) => b.peak)),
      total: all.reduce((s, b) => s + b.total, 0),
      activeDays: all.reduce((s, b) => s + b.activeDays, 0),
    };
  }, [events]);

  return (
    <div className="h-full overflow-y-auto">
      <ViewHeader title="Listening History" />
      <div className="px-6 md:px-8 pb-8 space-y-6">
        {blocks.map((block) => (
          <section key={block.first}>
            <h2 className="flex items-baseline justify-between gap-3 px-2 mb-1 text-sm font-semibold">
              <span>{blockLabel(block)}</span>
              <span className="text-xs font-medium text-muted tabular-nums">{formatHours(block.total)}</span>
            </h2>
            <HeatmapPlot block={block} max={max} />
          </section>
        ))}
        <HeatmapLegend
          summary={activeSummary(total, activeDays, blocks[0] ? `since ${keyOf(blocks[0].first)}` : "")}
        />
      </div>
    </div>
  );
}
