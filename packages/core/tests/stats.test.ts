import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bucketize,
  computeRecap,
  computeStreaks,
  dedupeEvents,
  filterRange,
  fixedOffsetZone,
  hourHistogram,
  rangeForPreset,
  rankGroups,
  rankTracks,
  recapYears,
  summarize,
  type BucketUnit,
  type GroupField,
  type RankBy,
  type StatsEvent,
  type StatsRangePreset,
  type StatsTrackMeta,
} from "../src/stats";

interface GoldenCase {
  name: string;
  call: {
    fn: string;
    preset?: StatsRangePreset;
    by?: RankBy;
    limit?: number;
    field?: GroupField;
    unit?: BucketUnit;
    year?: number;
  };
  expected: unknown;
}

interface GoldenFile {
  offsetMinutes: number;
  now: number;
  tracks: StatsTrackMeta[];
  events: StatsEvent[];
  cases: GoldenCase[];
}

const golden: GoldenFile = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../docs/fixtures/stats.golden.json", import.meta.url)), "utf8"),
);

const zone = fixedOffsetZone(golden.offsetMinutes);
const metaById = new Map(golden.tracks.map((t) => [t.id, t]));

function eventsFor(preset?: StatsRangePreset): StatsEvent[] {
  if (!preset) return golden.events;
  const { start, end } = rangeForPreset(preset, golden.now, zone);
  return filterRange(golden.events, start, end);
}

describe("stats golden fixtures (shared with Kotlin)", () => {
  for (const testCase of golden.cases) {
    it(testCase.name, () => {
      const { call } = testCase;
      const events = eventsFor(call.preset);
      const actual =
        call.fn === "summarize" ? summarize(events, metaById)
        : call.fn === "rankTracks" ? rankTracks(events, metaById, call.by!, call.limit!)
        : call.fn === "rankGroups" ? rankGroups(events, metaById, call.field!, call.by!, call.limit!)
        : call.fn === "bucketize" ? bucketize(events, zone, call.unit!)
        : call.fn === "hourHistogram" ? hourHistogram(events, zone)
        : call.fn === "streaks" ? computeStreaks(events, zone, golden.now)
        : call.fn === "recap" ? computeRecap(events, metaById, zone, call.year!)
        : call.fn === "recapYears" ? recapYears(events, zone)
        : call.fn === "rangeStart" ? rangeForPreset(call.preset!, golden.now, zone).start
        : (() => {
            throw new Error(`unknown fixture fn: ${call.fn}`);
          })();
      expect(actual).toEqual(testCase.expected);
    });
  }
});

describe("stats engine", () => {
  const zonePlus6 = fixedOffsetZone(360);

  it("dedupeEvents keeps the first occurrence of each id across sources", () => {
    const a: StatsEvent = { id: "e1", trackId: "t", playedAt: 0, durationPlayed: 10, completed: false };
    const b: StatsEvent = { id: "e1", trackId: "t", playedAt: 0, durationPlayed: 99, completed: true };
    const c: StatsEvent = { id: "e2", trackId: "t", playedAt: 1, durationPlayed: 5, completed: false };
    expect(dedupeEvents([a], [b, c])).toEqual([a, c]);
  });

  it("streaks on no events", () => {
    expect(computeStreaks([], zonePlus6, Date.parse("2026-07-16T12:00:00+06:00"))).toEqual({
      current: 0,
      longest: 0,
      longestStart: null,
      longestEnd: null,
      activeDays: 0,
    });
  });

  it("current streak survives a play-less today (counts from yesterday)", () => {
    const events: StatsEvent[] = [
      { id: "a", trackId: "t", playedAt: Date.parse("2026-07-14T10:00:00+06:00"), durationPlayed: 1, completed: false },
      { id: "b", trackId: "t", playedAt: Date.parse("2026-07-15T10:00:00+06:00"), durationPlayed: 1, completed: false },
    ];
    const streaks = computeStreaks(events, zonePlus6, Date.parse("2026-07-16T09:00:00+06:00"));
    expect(streaks.current).toBe(2);
  });

  it("fixed-offset zone splits days at local midnight, not UTC", () => {
    // 2026-07-11T18:00Z is exactly local midnight of 2026-07-12 at +06.
    expect(zonePlus6.parts(Date.parse("2026-07-11T17:59:59Z")).day).toBe(11);
    expect(zonePlus6.parts(Date.parse("2026-07-11T18:00:00Z")).day).toBe(12);
    expect(zonePlus6.epochAtMidnight(2026, 7, 12)).toBe(Date.parse("2026-07-11T18:00:00Z"));
  });

  it("rankTracks limit 0 returns nothing", () => {
    const events: StatsEvent[] = [
      { id: "a", trackId: "t", playedAt: 0, durationPlayed: 1, completed: false },
    ];
    expect(rankTracks(events, new Map(), "plays", 0)).toEqual([]);
  });
});
