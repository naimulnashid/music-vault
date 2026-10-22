import { describe, expect, it } from "vitest";
import { findCurrentLineIndex, parseLrc, toLrc } from "../src/lrc";

describe("parseLrc", () => {
  it("parses simple timestamped lines sorted by time", () => {
    const lrc = "[00:12.00]Line one\n[00:05.50]Line two\n[01:00]Line three";
    const lines = parseLrc(lrc);
    expect(lines).toEqual([
      { time: 5.5, text: "Line two" },
      { time: 12, text: "Line one" },
      { time: 60, text: "Line three" },
    ]);
  });

  it("expands multiple time tags on one line", () => {
    const lines = parseLrc("[00:01.00][00:03.00]Chorus");
    expect(lines.map((l) => l.time)).toEqual([1, 3]);
    expect(lines.every((l) => l.text === "Chorus")).toBe(true);
  });

  it("ignores metadata and untagged lines", () => {
    const lines = parseLrc("[ar:Artist]\nplain text\n[00:02.5]Real line");
    expect(lines).toEqual([{ time: 2.5, text: "Real line" }]);
  });

  it("pads fractional part correctly (centiseconds vs milliseconds)", () => {
    expect(parseLrc("[00:01.5]a")[0].time).toBeCloseTo(1.5);
    expect(parseLrc("[00:01.50]a")[0].time).toBeCloseTo(1.5);
    expect(parseLrc("[00:01.500]a")[0].time).toBeCloseTo(1.5);
  });

  it("handles CRLF input and empty content", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("[00:01.00]a\r\n[00:02.00]b").length).toBe(2);
  });
});

describe("findCurrentLineIndex", () => {
  const lines = parseLrc("[00:05]a\n[00:10]b\n[00:15]c");

  it("returns -1 before the first line", () => {
    expect(findCurrentLineIndex(lines, 2)).toBe(-1);
  });

  it("returns the active line at and between timestamps", () => {
    expect(findCurrentLineIndex(lines, 5)).toBe(0);
    expect(findCurrentLineIndex(lines, 12)).toBe(1);
    expect(findCurrentLineIndex(lines, 99)).toBe(2);
  });
});

describe("toLrc", () => {
  it("writes one time tag per line, in time order", () => {
    expect(toLrc([{ time: 12, text: "Two" }, { time: 5.5, text: "One" }])).toBe("[00:05.50]One\n[00:12.00]Two\n");
  });

  it("carries rounding into the next second and minute", () => {
    expect(toLrc([{ time: 59.996, text: "a" }])).toBe("[01:00.00]a\n");
    expect(toLrc([{ time: 61.234, text: "b" }])).toBe("[01:01.23]b\n");
  });

  it("reads back as the same lines", () => {
    const lines = [
      { time: 0, text: "" },
      { time: 3.25, text: "Hello" },
      { time: 125.5, text: "আমার সোনার বাংলা" },
    ];
    expect(parseLrc(toLrc(lines))).toEqual(lines);
  });
});
