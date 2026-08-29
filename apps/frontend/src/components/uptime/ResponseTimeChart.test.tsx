import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MonitorStats } from "../../api/types";
import { ResponseTimeChart } from "./ResponseTimeChart";
import { niceMax, responseTimeChartModel } from "./response-time-chart";

type SeriesPoint = MonitorStats["series"][number];

function point(
  minute: number,
  responseTimeMs: number | null,
  status: SeriesPoint["status"] = "PASSED",
): SeriesPoint {
  return {
    responseTimeMs,
    status,
    t: `2026-08-19T10:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

describe("response-time chart model", () => {
  it("rounds the axis ceiling up to 1, 2 or 5 × 10ⁿ", () => {
    expect(niceMax(184)).toBe(200);
    expect(niceMax(95)).toBe(100);
    expect(niceMax(1_234)).toBe(2_000);
    expect(niceMax(0)).toBe(100);
  });

  it("uses real timestamps and sorts points chronologically", () => {
    const later = point(10, 90);
    const earlier = point(0, 80);
    const windowEnd = Date.parse(later.t) + 60_000;
    const model = responseTimeChartModel([later, earlier], 85, windowEnd);

    expect(model.points.map((item) => item.t)).toEqual([earlier.t, later.t]);
    expect(model.points.map((item) => item.timestamp)).toEqual([
      Date.parse(earlier.t),
      Date.parse(later.t),
    ]);
    expect(model.timeDomain).toEqual([
      windowEnd - 24 * 60 * 60 * 1_000,
      windowEnd,
    ]);
  });

  it("keeps missing responses null and only marks measured failures", () => {
    const model = responseTimeChartModel([
      point(0, 80),
      point(5, null, "FAILED"),
      point(10, 184, "FAILED"),
    ], 132);

    expect(model.points.map((item) => item.responseTimeMs)).toEqual([80, null, 184]);
    expect(model.points.map((item) => item.failedResponseTimeMs)).toEqual([null, null, 184]);
    expect(model.failedAttempts).toBe(2);
    expect(model.measuredPoints).toBe(2);
    expect(model.noResponseAttempts).toBe(1);
    expect(model.points.some((item) => item.responseTimeMs === 0)).toBe(false);
  });

  it("uses the exact supplied average rather than deriving one from downsampled points", () => {
    const model = responseTimeChartModel([point(0, 10), point(10, 300)], 127.45);

    expect(model.averageMs).toBe(127.45);
    expect(model.latest?.responseTimeMs).toBe(300);
  });

  it("keeps a true 24-hour time domain for a young monitor", () => {
    const only = point(0, 80);
    const windowEnd = Date.parse(only.t) + 10 * 60_000;
    const model = responseTimeChartModel([only], 80, windowEnd);

    expect(model.timeDomain).toEqual([
      windowEnd - 24 * 60 * 60 * 1_000,
      windowEnd,
    ]);
  });
});

describe("ResponseTimeChart", () => {
  it("renders the operational summary, precise legend, and textual chart alternative", () => {
    const html = renderToStaticMarkup(
      <ResponseTimeChart
        averageMs={91.4}
        series={[point(0, 80), point(5, null, "FAILED"), point(10, 100)]}
        timezone="UTC"
      />,
    );

    expect(html).toContain("Response time");
    expect(html).toContain("Failed attempt");
    expect(html).toContain("plotted point had no response");
    expect(html).toContain("Exact 24 h average");
    expect(html).toContain("Average 91 ms");
    expect(html).toContain("1 failed attempt");
    expect(html).toContain("1 plotted point had no response");
  });

  it("renders an informative empty state", () => {
    const html = renderToStaticMarkup(
      <ResponseTimeChart averageMs={null} series={[]} timezone="UTC" />,
    );

    expect(html).toContain("Not enough data yet");
    expect(html).toContain("Waiting for a check");
  });

  it("explains when attempts exist but none has a response measurement", () => {
    const html = renderToStaticMarkup(
      <ResponseTimeChart
        averageMs={null}
        series={[point(0, null, "FAILED")]}
        timezone="UTC"
      />,
    );

    expect(html).toContain("No response measurements");
    expect(html).toContain("did not return a measurable response time");
  });
});
