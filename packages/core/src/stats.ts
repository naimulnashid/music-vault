/**
 * Statistics 2.0 — pure aggregation over the append-only play-event stream.
 *
 * Every client feeds this the merged event list (local log + sync shadow,
 * deduped by event id) plus a metadata lookup, and renders the results.
 * Calendar bucketing goes through a pluggable {@link StatsZone} so results
 * are deterministic in tests (fixed offset) while clients use the device
 * timezone. The Kotlin port in apps/android must match this file's semantics;
 * both are verified against docs/fixtures/stats.golden.json.
 */

// ---- inputs -----------------------------------------------------------------

/** One playback session (mirrors the play_events table / playEvent.add op). */
export interface StatsEvent {
  id: string;
  trackId: string;
  /** Epoch ms when the session started. */
  playedAt: number;
  /** Seconds actually listened during the session. */
  durationPlayed: number;
  /** True when >= 90% of the track was heard. */
  completed: boolean;
}

/** The metadata stats needs about a track. Lookup may miss (deleted tracks). */
export interface StatsTrackMeta {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre?: string | null;
}

export const UNKNOWN_TRACK: StatsTrackMeta = {
  id: "",
  title: "Unknown Track",
  artist: "Unknown Artist",
  album: "Unknown Album",
  genre: null,
};

/**
 * Maps instants to a local calendar. month is 1-12, day 1-31, hour 0-23.
 * epochAtMidnight is the inverse: the instant a local calendar day begins.
 */
export interface StatsZone {
  parts(epochMs: number): { year: number; month: number; day: number; hour: number };
  epochAtMidnight(year: number, month: number, day: number): number;
}

/** Fixed UTC offset zone — what the golden fixtures use. */
export function fixedOffsetZone(offsetMinutes: number): StatsZone {
  const shift = offsetMinutes * 60_000;
  return {
    parts(epochMs) {
      const d = new Date(epochMs + shift);
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
      };
    },
    epochAtMidnight(year, month, day) {
      return Date.UTC(year, month - 1, day) - shift;
    },
  };
}

/** The device's local timezone (DST-correct via the JS Date locals). */
export function systemZone(): StatsZone {
  return {
    parts(epochMs) {
      const d = new Date(epochMs);
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours() };
    },
    epochAtMidnight(year, month, day) {
      return new Date(year, month - 1, day).getTime();
    },
  };
}

// ---- small helpers ----------------------------------------------------------

/** NUL separator for composite group keys — can't collide with real names. */
const GROUP_SEP = String.fromCharCode(0);

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Days since 1970-01-01 for a local calendar date — adjacency for streaks. */
function epochDayOf(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function dayKeyOf(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Merge event lists from different sources, keeping the first of each id. */
export function dedupeEvents(...sources: StatsEvent[][]): StatsEvent[] {
  const seen = new Set<string>();
  const out: StatsEvent[] = [];
  for (const source of sources) {
    for (const event of source) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      out.push(event);
    }
  }
  return out;
}

/** Events with startMs <= playedAt < endMs (either bound optional). */
export function filterRange(events: StatsEvent[], startMs?: number, endMs?: number): StatsEvent[] {
  return events.filter(
    (e) => (startMs === undefined || e.playedAt >= startMs) && (endMs === undefined || e.playedAt < endMs),
  );
}

// ---- range presets ----------------------------------------------------------

export type StatsRangePreset = "last7Days" | "last30Days" | "last90Days" | "thisYear" | "allTime";

export const STATS_RANGE_PRESETS: Record<StatsRangePreset, string> = {
  last7Days: "Last 7 days",
  last30Days: "Last 30 days",
  last90Days: "Last 90 days",
  thisYear: "This year",
  allTime: "All time",
};

/**
 * [start, end) instants for a preset. Day presets start at local midnight
 * N-1 days back so "last 7 days" spans 7 calendar days including today.
 */
export function rangeForPreset(
  preset: StatsRangePreset,
  nowMs: number,
  zone: StatsZone,
): { start?: number; end?: number } {
  if (preset === "allTime") return {};
  const today = zone.parts(nowMs);
  if (preset === "thisYear") return { start: zone.epochAtMidnight(today.year, 1, 1) };
  const days = preset === "last7Days" ? 7 : preset === "last30Days" ? 30 : 90;
  const startDay = epochDayOf(today.year, today.month, today.day) - (days - 1);
  const d = new Date(startDay * 86_400_000);
  return { start: zone.epochAtMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) };
}

// ---- summary ----------------------------------------------------------------

export interface StatsSummary {
  plays: number;
  completedPlays: number;
  listenSeconds: number;
  uniqueTracks: number;
  uniqueArtists: number;
  uniqueAlbums: number;
}

export function summarize(events: StatsEvent[], metaById: Map<string, StatsTrackMeta>): StatsSummary {
  const tracks = new Set<string>();
  const artists = new Set<string>();
  const albums = new Set<string>();
  let plays = 0;
  let completedPlays = 0;
  let listenSeconds = 0;
  for (const event of events) {
    plays += 1;
    if (event.completed) completedPlays += 1;
    listenSeconds += event.durationPlayed;
    tracks.add(event.trackId);
    const meta = metaById.get(event.trackId) ?? UNKNOWN_TRACK;
    artists.add(meta.artist);
    albums.add(`${meta.album}${GROUP_SEP}${meta.artist}`);
  }
  return {
    plays,
    completedPlays,
    listenSeconds,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
  };
}

// ---- rankings ---------------------------------------------------------------

export type RankBy = "plays" | "time";

export interface RankedTrack {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  plays: number;
  listenSeconds: number;
}

export interface RankedGroup {
  /** Artist / album / genre name ("Unknown …" fallbacks for missing meta). */
  name: string;
  /** For albums: the artist. Empty otherwise. */
  secondary: string;
  plays: number;
  listenSeconds: number;
}

/**
 * Deterministic ranking: primary metric desc, other metric desc, then
 * name/id asc — ties can't reorder between engines.
 */
function compareRanked(
  by: RankBy,
  a: { plays: number; listenSeconds: number },
  b: { plays: number; listenSeconds: number },
  tieA: string,
  tieB: string,
): number {
  const primary = by === "plays" ? b.plays - a.plays : b.listenSeconds - a.listenSeconds;
  if (primary !== 0) return primary;
  const secondary = by === "plays" ? b.listenSeconds - a.listenSeconds : b.plays - a.plays;
  if (secondary !== 0) return secondary;
  return tieA < tieB ? -1 : tieA > tieB ? 1 : 0;
}

export function rankTracks(
  events: StatsEvent[],
  metaById: Map<string, StatsTrackMeta>,
  by: RankBy,
  limit: number,
): RankedTrack[] {
  const acc = new Map<string, RankedTrack>();
  for (const event of events) {
    let entry = acc.get(event.trackId);
    if (!entry) {
      const meta = metaById.get(event.trackId) ?? UNKNOWN_TRACK;
      entry = {
        trackId: event.trackId,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        plays: 0,
        listenSeconds: 0,
      };
      acc.set(event.trackId, entry);
    }
    entry.plays += 1;
    entry.listenSeconds += event.durationPlayed;
  }
  return [...acc.values()].sort((a, b) => compareRanked(by, a, b, a.trackId, b.trackId)).slice(0, Math.max(0, limit));
}

export type GroupField = "artist" | "album" | "genre";

export function rankGroups(
  events: StatsEvent[],
  metaById: Map<string, StatsTrackMeta>,
  field: GroupField,
  by: RankBy,
  limit: number,
): RankedGroup[] {
  const acc = new Map<string, RankedGroup>();
  for (const event of events) {
    const meta = metaById.get(event.trackId) ?? UNKNOWN_TRACK;
    let name: string;
    let secondary = "";
    if (field === "artist") {
      name = meta.artist;
    } else if (field === "album") {
      name = meta.album;
      secondary = meta.artist;
    } else {
      name = meta.genre || "Unknown Genre";
    }
    const key = `${name}${GROUP_SEP}${secondary}`;
    let entry = acc.get(key);
    if (!entry) {
      entry = { name, secondary, plays: 0, listenSeconds: 0 };
      acc.set(key, entry);
    }
    entry.plays += 1;
    entry.listenSeconds += event.durationPlayed;
  }
  return [...acc.values()]
    .sort((a, b) =>
      compareRanked(by, a, b, `${a.name}${GROUP_SEP}${a.secondary}`, `${b.name}${GROUP_SEP}${b.secondary}`),
    )
    .slice(0, Math.max(0, limit));
}

// ---- calendar buckets (charts + heatmap) --------------------------------------

export interface StatsBucket {
  /** "YYYY-MM-DD", "YYYY-MM" or "YYYY" depending on the unit. */
  key: string;
  plays: number;
  listenSeconds: number;
}

export type BucketUnit = "day" | "month" | "year";

/** Buckets sorted by key ascending; empty periods are absent. */
export function bucketize(events: StatsEvent[], zone: StatsZone, unit: BucketUnit): StatsBucket[] {
  const acc = new Map<string, StatsBucket>();
  for (const event of events) {
    const p = zone.parts(event.playedAt);
    const key =
      unit === "day" ? dayKeyOf(p.year, p.month, p.day) : unit === "month" ? `${pad(p.year, 4)}-${pad(p.month, 2)}` : pad(p.year, 4);
    let entry = acc.get(key);
    if (!entry) {
      entry = { key, plays: 0, listenSeconds: 0 };
      acc.set(key, entry);
    }
    entry.plays += 1;
    entry.listenSeconds += event.durationPlayed;
  }
  return [...acc.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Listening seconds and plays per hour of day, index 0-23. */
export function hourHistogram(events: StatsEvent[], zone: StatsZone): { plays: number; listenSeconds: number }[] {
  const out = Array.from({ length: 24 }, () => ({ plays: 0, listenSeconds: 0 }));
  for (const event of events) {
    const slot = out[zone.parts(event.playedAt).hour];
    slot.plays += 1;
    slot.listenSeconds += event.durationPlayed;
  }
  return out;
}

// ---- streaks ------------------------------------------------------------------

export interface StatsStreaks {
  /** Days in the run ending today (or yesterday — today isn't over yet). */
  current: number;
  longest: number;
  /** First/last day key of the longest run; null when no events. */
  longestStart: string | null;
  longestEnd: string | null;
  /** Total distinct local days with at least one play. */
  activeDays: number;
}

export function computeStreaks(events: StatsEvent[], zone: StatsZone, nowMs: number): StatsStreaks {
  const days = new Set<number>();
  for (const event of events) {
    const p = zone.parts(event.playedAt);
    days.add(epochDayOf(p.year, p.month, p.day));
  }
  const sorted = [...days].sort((a, b) => a - b);
  const keyOf = (epochDay: number): string => {
    const d = new Date(epochDay * 86_400_000);
    return dayKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };

  let longest = 0;
  let longestStart: number | null = null;
  let runStart: number | null = null;
  let prev: number | null = null;
  for (const day of sorted) {
    if (prev === null || day !== prev + 1) runStart = day;
    prev = day;
    const run = day - (runStart as number) + 1;
    if (run > longest) {
      longest = run;
      longestStart = runStart;
    }
  }

  const todayParts = zone.parts(nowMs);
  const today = epochDayOf(todayParts.year, todayParts.month, todayParts.day);
  let current = 0;
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  while (cursor !== null && days.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  return {
    current,
    longest,
    longestStart: longestStart === null ? null : keyOf(longestStart),
    longestEnd: longestStart === null ? null : keyOf(longestStart + longest - 1),
    activeDays: days.size,
  };
}

// ---- yearly recap ("Wrapped") ---------------------------------------------------

export interface StatsRecap {
  year: number;
  plays: number;
  listenSeconds: number;
  uniqueTracks: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  activeDays: number;
  topTracks: RankedTrack[];
  topArtists: RankedGroup[];
  topAlbums: RankedGroup[];
  topGenres: RankedGroup[];
  /** The single biggest listening day of the year. */
  peakDay: StatsBucket | null;
  longestStreak: number;
  /** Hour of day (0-23) with the most listening time; null when no events. */
  mostActiveHour: number | null;
  /** Listening seconds per month, index 0 = January. */
  monthlySeconds: number[];
}

export function computeRecap(
  events: StatsEvent[],
  metaById: Map<string, StatsTrackMeta>,
  zone: StatsZone,
  year: number,
): StatsRecap {
  const start = zone.epochAtMidnight(year, 1, 1);
  const end = zone.epochAtMidnight(year + 1, 1, 1);
  const inYear = filterRange(events, start, end);
  const summary = summarize(inYear, metaById);
  const dayBuckets = bucketize(inYear, zone, "day");

  // Buckets are key-ascending, so a strict > keeps the earliest day on ties.
  let peakDay: StatsBucket | null = null;
  for (const bucket of dayBuckets) {
    if (peakDay === null || bucket.listenSeconds > peakDay.listenSeconds) peakDay = bucket;
  }

  const hours = hourHistogram(inYear, zone);
  let mostActiveHour: number | null = null;
  for (let h = 0; h < 24; h++) {
    if (hours[h].listenSeconds > 0 && (mostActiveHour === null || hours[h].listenSeconds > hours[mostActiveHour].listenSeconds)) {
      mostActiveHour = h;
    }
  }

  const monthlySeconds = Array.from({ length: 12 }, () => 0);
  for (const bucket of bucketize(inYear, zone, "month")) {
    monthlySeconds[Number(bucket.key.slice(5, 7)) - 1] = bucket.listenSeconds;
  }

  // Streak computation clamped to the year: pass end-of-year as "now" so the
  // current-streak probe stays inside it; we only surface the longest run.
  const streaks = computeStreaks(inYear, zone, end - 1);

  return {
    year,
    plays: summary.plays,
    listenSeconds: summary.listenSeconds,
    uniqueTracks: summary.uniqueTracks,
    uniqueArtists: summary.uniqueArtists,
    uniqueAlbums: summary.uniqueAlbums,
    activeDays: streaks.activeDays,
    topTracks: rankTracks(inYear, metaById, "time", 5),
    topArtists: rankGroups(inYear, metaById, "artist", "time", 5),
    topAlbums: rankGroups(inYear, metaById, "album", "time", 5),
    topGenres: rankGroups(inYear, metaById, "genre", "time", 3),
    peakDay,
    longestStreak: streaks.longest,
    mostActiveHour,
    monthlySeconds,
  };
}

/** Years (descending) that have at least one event — drives recap pickers. */
export function recapYears(events: StatsEvent[], zone: StatsZone): number[] {
  const years = new Set<number>();
  for (const event of events) years.add(zone.parts(event.playedAt).year);
  return [...years].sort((a, b) => b - a);
}
