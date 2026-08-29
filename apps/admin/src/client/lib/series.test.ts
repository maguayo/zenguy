import { describe, expect, it } from "vitest";

import type { TestsDayPoint } from "../../shared/types";
import {
  formatDayLabel,
  formatDayTick,
  formatUsd,
  isEmptySeries,
  pct,
  retriesShares,
  sumBy,
  testsPoints,
} from "./series";

const day = (overrides: Partial<TestsDayPoint>): TestsDayPoint => ({
  day: "2026-08-29",
  passed: 0,
  failed: 0,
  timeout: 0,
  systemError: 0,
  total: 0,
  avgDurationMs: null,
  ...overrides,
});

describe("day formatters", () => {
  it("prints UTC ticks and labels", () => {
    expect(formatDayTick("2026-08-29")).toBe("29 Aug");
    expect(formatDayLabel("2026-08-29")).toBe("29 Aug 2026");
  });

  it("passes malformed days through untouched", () => {
    expect(formatDayTick("not-a-day")).toBe("not-a-day");
  });
});

describe("formatUsd", () => {
  it("hides cents on whole dollars and shows them otherwise", () => {
    expect(formatUsd(300)).toBe("$3");
    expect(formatUsd(225)).toBe("$2.25");
    expect(formatUsd(0)).toBe("$0");
  });
});

describe("pct", () => {
  it("rounds and dashes null", () => {
    expect(pct(66.6)).toBe("67%");
    expect(pct(null)).toBe("—");
  });
});

describe("testsPoints", () => {
  it("derives the in-progress segment and the pass rate over finished runs", () => {
    const [point] = testsPoints([
      day({ passed: 3, failed: 1, timeout: 0, systemError: 0, total: 6, avgDurationMs: 1000 }),
    ]);
    expect(point).toMatchObject({ inProgress: 2, passRatePct: 75 });
  });

  it("breaks the pass-rate line on days where nothing finished", () => {
    const [point] = testsPoints([day({ total: 2 })]);
    expect(point).toMatchObject({ inProgress: 2, passRatePct: null });
  });
});

describe("series helpers", () => {
  it("sums a key and detects an all-zero series", () => {
    const series = [day({ total: 2 }), day({ day: "2026-08-30", total: 3 })];
    expect(sumBy(series, "total")).toBe(5);
    expect(isEmptySeries(series, ["total"])).toBe(false);
    expect(isEmptySeries(series, ["passed", "failed"])).toBe(true);
  });
});

describe("retriesShares", () => {
  it("splits passing runs into ordered shares", () => {
    expect(retriesShares({ first: 6, second: 3, thirdPlus: 1 })).toEqual([
      { key: "first", label: "1ª", count: 6, sharePct: 60 },
      { key: "second", label: "2ª", count: 3, sharePct: 30 },
      { key: "thirdPlus", label: "3ª+", count: 1, sharePct: 10 },
    ]);
  });

  it("returns zero shares when nothing passed", () => {
    for (const share of retriesShares({ first: 0, second: 0, thirdPlus: 0 })) {
      expect(share.sharePct).toBe(0);
      expect(share.count).toBe(0);
    }
  });
});
