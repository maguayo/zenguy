import { describe, expect, it } from "vitest";

import { BASE_FEE_CENTS, LINES, computeCosts } from "./pricing";

// 2023-11-14T22:13:20Z → 14 days elapsed of a 30-day month.
const NOW = 1_700_000_000_000;
const GB = 1_000_000_000;

describe("LINES", () => {
  it("prices every line in the same currency unit and never duplicates a metric", () => {
    const seen = new Set<string>();
    for (const line of LINES) {
      expect(line.priceCentsPerUnit).toBeGreaterThan(0);
      expect(line.unitSize).toBeGreaterThan(0);
      for (const metric of line.metrics) {
        expect(seen.has(metric), metric).toBe(false);
        seen.add(metric);
      }
    }
    expect(BASE_FEE_CENTS).toBe(500);
  });
});

describe("computeCosts", () => {
  it("charges only the month-to-date usage above the included quota", () => {
    const costs = computeCosts(
      [
        { day: "2023-11-01", metric: "workers.requests", value: 8_000_000 },
        { day: "2023-11-02", metric: "workers.requests", value: 5_000_000 },
        // Last month never counts toward this month's quota.
        { day: "2023-10-31", metric: "workers.requests", value: 50_000_000 },
      ],
      NOW,
      30,
    );
    const requests = costs.lines.find((line) => line.key === "workers.requests");
    expect(requests).toMatchObject({
      unit: "M requests",
      monthToDate: 13,
      included: 10,
      overage: 3,
      unitPriceCents: 30,
      costCents: 90,
    });
    expect(costs.month).toEqual({
      key: "2023-11",
      from: "2023-11-01",
      to: "2023-11-30",
      daysElapsed: 14,
      daysInMonth: 30,
    });
    expect(costs.baseFeeCents).toBe(500);
    expect(costs.totalCents).toBe(590);
    // 90¢ of usage over 14 days → ~193¢ over 30 days, plus the base fee.
    expect(costs.projectedCents).toBe(500 + Math.round((90 * 30) / 14));
    expect(costs.topLine).toEqual({ key: "workers.requests", label: "Workers requests", costCents: 90 });
  });

  it("bills storage on the month's average daily footprint, not the sum", () => {
    const costs = computeCosts(
      [
        { day: "2023-11-01", metric: "d1.storage_bytes", value: 6 * GB },
        { day: "2023-11-02", metric: "d1.storage_bytes", value: 8 * GB },
      ],
      NOW,
      30,
    );
    const storage = costs.lines.find((line) => line.key === "d1.storage");
    expect(storage).toMatchObject({ unit: "GB-month", monthToDate: 7, included: 5, overage: 2, costCents: 150 });
  });

  it("attributes the daily series to the day the quota was crossed", () => {
    const costs = computeCosts(
      [
        { day: "2023-11-12", metric: "workers.requests", value: 8_000_000 },
        { day: "2023-11-13", metric: "workers.requests", value: 5_000_000 },
        { day: "2023-11-14", metric: "workers.requests", value: 1_000_000 },
      ],
      NOW,
      7,
    );
    expect(costs.series).toHaveLength(7);
    const byDay = new Map(costs.series.map((point) => [point.day, point]));
    expect(byDay.get("2023-11-12")?.totalCents).toBe(0);
    expect(byDay.get("2023-11-13")).toEqual({
      day: "2023-11-13",
      byLine: { "workers.requests": 90 },
      totalCents: 90,
    });
    expect(byDay.get("2023-11-14")).toEqual({
      day: "2023-11-14",
      byLine: { "workers.requests": 30 },
      totalCents: 30,
    });
    expect(byDay.get("2023-11-08")).toEqual({ day: "2023-11-08", byLine: {}, totalCents: 0 });
  });

  it("reports zero cost and no top line without usage", () => {
    const costs = computeCosts([], NOW, 7);
    expect(costs.totalCents).toBe(BASE_FEE_CENTS);
    expect(costs.topLine).toBeNull();
    expect(costs.lines.every((line) => line.costCents === 0)).toBe(true);
  });
});
