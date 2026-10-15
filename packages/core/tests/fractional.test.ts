import { describe, expect, it } from "vitest";
import { keyBetween, nKeysBetween, validateOrderKey } from "../src/sync";

describe("fractional index keys", () => {
  it("starts at a0", () => {
    expect(keyBetween(null, null)).toBe("a0");
  });

  it("appends and prepends without bound", () => {
    let key = keyBetween(null, null);
    const appended = [key];
    for (let i = 0; i < 200; i++) {
      const next = keyBetween(key, null);
      expect(next > key).toBe(true);
      appended.push(next);
      key = next;
    }
    key = appended[0];
    for (let i = 0; i < 200; i++) {
      const prev = keyBetween(null, key);
      expect(prev < key).toBe(true);
      key = prev;
    }
  });

  it("inserts between adjacent keys", () => {
    const a = "a0";
    const b = keyBetween(a, null);
    const mid = keyBetween(a, b);
    expect(mid > a && mid < b).toBe(true);
  });

  it("stays ordered under randomized insertion", () => {
    const keys: string[] = [keyBetween(null, null)];
    let seed = 42;
    const rand = () => {
      // deterministic LCG so failures reproduce
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(rand() * (keys.length + 1));
      const before = at === 0 ? null : keys[at - 1];
      const after = at === keys.length ? null : keys[at];
      const key = keyBetween(before, after);
      if (before !== null) expect(key > before).toBe(true);
      if (after !== null) expect(key < after).toBe(true);
      keys.splice(at, 0, key);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(() => validateOrderKey(key)).not.toThrow();
  });

  it("generates n ascending keys between bounds", () => {
    const keys = nKeysBetween("a0", "a1", 20);
    expect(keys).toHaveLength(20);
    let prev = "a0";
    for (const key of keys) {
      expect(key > prev).toBe(true);
      prev = key;
    }
    expect(prev < "a1").toBe(true);

    expect(nKeysBetween(null, null, 5)).toHaveLength(5);
    expect(nKeysBetween("a0", null, 3).every((k) => k > "a0")).toBe(true);
    expect(nKeysBetween(null, "a0", 3).every((k) => k < "a0")).toBe(true);
  });

  it("rejects invalid arguments", () => {
    expect(() => keyBetween("a1", "a0")).toThrow();
    expect(() => keyBetween("a0", "a0")).toThrow();
    expect(() => keyBetween("!!", null)).toThrow();
    expect(() => validateOrderKey("a00")).toThrow(); // trailing smallest digit
  });
});
