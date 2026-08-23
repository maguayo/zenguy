import { describe, expect, it } from "vitest";

import { DEFAULT_RANGE, RANGES, RANGE_STORAGE_KEY, parseRange } from "./range";

describe("range", () => {
  it("offers exactly the three windows the analytics endpoint accepts", () => {
    expect(RANGES).toEqual([7, 30, 90]);
    expect(DEFAULT_RANGE).toBe(30);
    expect(RANGE_STORAGE_KEY).toBe("zenguy-admin:range");
  });

  it("accepts a stored window and falls back to the default for anything else", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("14")).toBe(30);
    expect(parseRange("")).toBe(30);
    expect(parseRange(null)).toBe(30);
  });
});
