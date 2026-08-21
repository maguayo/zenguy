import { describe, expect, it } from "@jest/globals";

import { niceMax, responseTimeBars, type SeriesPoint } from "./response-time-chart";

function point(minute: number, responseTimeMs: number | null, status: SeriesPoint["status"] = "PASSED"): SeriesPoint {
  return { responseTimeMs, status, t: `2026-08-19T10:${String(minute).padStart(2, "0")}:00.000Z` };
}

describe("response-time chart model", () => {
  it("rounds the axis ceiling up to 1, 2 or 5 × 10ⁿ", () => {
    expect(niceMax(184)).toBe(200);
    expect(niceMax(95)).toBe(100);
    expect(niceMax(1_234)).toBe(2_000);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(200)).toBe(200);
    expect(niceMax(0)).toBe(100);
    expect(niceMax(Number.NaN)).toBe(100);
  });

  it("is empty without data", () => {
    expect(responseTimeBars([])).toEqual({ bars: [], max: 0 });
  });

  it("scales bars against the ceiling and flags failed checks", () => {
    const model = responseTimeBars([point(0, 184), point(5, null, "FAILED"), point(10, 50)]);
    expect(model.max).toBe(200);
    expect(model.bars.map((bar) => bar.heightPct)).toEqual([92, 0, 25]);
    expect(model.bars.map((bar) => bar.failed)).toEqual([false, true, false]);
    expect(model.bars.map((bar) => bar.t)).toEqual([
      "2026-08-19T10:00:00.000Z",
      "2026-08-19T10:05:00.000Z",
      "2026-08-19T10:10:00.000Z",
    ]);
  });

  it("folds long series into consecutive buckets", () => {
    const series = Array.from({ length: 10 }, (_, index) =>
      point(index, index === 3 ? null : 100 + index * 10, index === 3 ? "FAILED" : "PASSED"),
    );
    const model = responseTimeBars(series, 4);
    expect(model.bars).toHaveLength(4);
    expect(model.bars.map((bar) => bar.responseTimeMs)).toEqual([110, 145, 170, 190]);
    expect(model.bars.map((bar) => bar.failed)).toEqual([false, true, false, false]);
    expect(model.bars.map((bar) => bar.t)).toEqual([series[0]?.t, series[3]?.t, series[6]?.t, series[9]?.t]);
    expect(new Set(model.bars.map((bar) => bar.key)).size).toBe(4);
  });
});
