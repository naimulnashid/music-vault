import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  defaultConditionFor,
  emptySmartRules,
  evaluateSmartRules,
  matchesGroup,
  RULE_FIELDS,
  RULE_OPS_FOR_TYPE,
  type RuleField,
  type RuleTrackInput,
  type SmartRules,
} from "../src/smartRules";

interface GoldenFile {
  now: number;
  tracks: RuleTrackInput[];
  cases: { name: string; rules: SmartRules; expected: string[] }[];
}

const golden: GoldenFile = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../docs/fixtures/smart-rules.golden.json", import.meta.url)), "utf8"),
);

describe("smart rules golden fixtures (shared with Kotlin)", () => {
  for (const testCase of golden.cases) {
    it(testCase.name, () => {
      expect(evaluateSmartRules(testCase.rules, golden.tracks, golden.now)).toEqual(testCase.expected);
    });
  }
});

describe("smart rules engine", () => {
  const base: RuleTrackInput = {
    id: "x",
    title: "Song",
    artist: "Artist",
    album: "Album",
    duration: 100,
    playCount: 0,
    addedAt: 0,
    favorite: false,
  };

  it("empty rules match everything", () => {
    expect(matchesGroup(emptySmartRules().root, base, Date.now())).toBe(true);
  });

  it("a saved rule naming the retired rating field matches nothing", () => {
    const rules: SmartRules = {
      version: 1,
      root: { combinator: "and", rules: [{ field: "rating" as RuleField, op: "isSet" }] },
    };
    expect(evaluateSmartRules(rules, [base], 0)).toEqual([]);
  });

  it("limit 0 returns nothing, negative limit is ignored", () => {
    const rules = emptySmartRules();
    expect(evaluateSmartRules({ ...rules, limit: 0 }, [base], 0)).toEqual([]);
    expect(evaluateSmartRules({ ...rules, limit: -1 }, [base], 0)).toEqual(["x"]);
  });

  it("every field has a valid default condition", () => {
    for (const field of Object.keys(RULE_FIELDS) as RuleField[]) {
      const cond = defaultConditionFor(field);
      expect(cond.field).toBe(field);
      expect(RULE_OPS_FOR_TYPE[RULE_FIELDS[field].type]).toContain(cond.op);
    }
  });
});
