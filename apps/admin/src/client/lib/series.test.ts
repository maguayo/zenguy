import { describe, expect, it } from "vitest";

import type { Analytics, ChecksDay, DeliveriesDay, RunsDay, UsersDay } from "../../shared/types";
import {
  channelTotals,
  deliverySeries,
  fillAnalytics,
  fillDays,
  finishedRuns,
  formatDayLabel,
  formatDayTick,
  formatEuros,
  formatPct,
  formatTokens,
  hasFallback,
  isEmpty,
  lastOf,
  mrrBreakdown,
  passRate,
  periodDelta,
  runSeries,
  sparkDomain,
  sparkline,
  sumSeries,
  uptimePct,
  utcDays,
} from "./series";

const usersDay = (day: string, signups: number, cumulative: number, dau = 0): UsersDay => ({
  cumulative,
  dau,
  day,
  signups,
  wau: null,
});

const runsDay = (day: string, patch: Partial<RunsDay> = {}): RunsDay => ({
  avgDurationMs: null,
  day,
  failed: 0,
  fallback: 0,
  inputTokens: 0,
  outputTokens: 0,
  passed: 0,
  systemError: 0,
  timeout: 0,
  total: 0,
  ...patch,
});

describe("utcDays", () => {
  it("walks back from the last day, oldest first", () => {
    expect(utcDays("2026-08-23", 3)).toEqual(["2026-08-21", "2026-08-22", "2026-08-23"]);
  });

  it("crosses month and year boundaries on UTC arithmetic", () => {
    expect(utcDays("2026-03-01", 2)).toEqual(["2026-02-28", "2026-03-01"]);
    expect(utcDays("2026-01-01", 2)).toEqual(["2025-12-31", "2026-01-01"]);
  });

  it("returns nothing for a non-positive window or an unparseable day", () => {
    expect(utcDays("2026-08-23", 0)).toEqual([]);
    expect(utcDays("not-a-day", 3)).toEqual([]);
  });
});

describe("fillDays", () => {
  const blank = (day: string) => usersDay(day, 0, 0);

  it("zero-fills the days the server did not send and sorts oldest first", () => {
    const filled = fillDays(
      [usersDay("2026-08-23", 2, 12), usersDay("2026-08-21", 1, 9)],
      { days: 3, to: "2026-08-23" },
      blank,
    );
    expect(filled.map((point) => point.day)).toEqual([
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
    expect(filled.map((point) => point.signups)).toEqual([1, 0, 2]);
  });

  it("drops days outside the window instead of widening the axis", () => {
    const filled = fillDays([usersDay("2026-07-01", 5, 5)], { days: 2, to: "2026-08-23" }, blank);
    expect(filled).toHaveLength(2);
    expect(filled.every((point) => point.signups === 0)).toBe(true);
  });
});

describe("aggregates", () => {
  it("sums one numeric key across the series", () => {
    expect(sumSeries([runsDay("a", { total: 3 }), runsDay("b", { total: 4 })], "total")).toBe(7);
    expect(sumSeries([] as RunsDay[], "total")).toBe(0);
  });

  it("returns the last point, or undefined for an empty series", () => {
    expect(lastOf([runsDay("a"), runsDay("b")])?.day).toBe("b");
    expect(lastOf([])).toBeUndefined();
  });

  it("rates a day over the runs that finished, not the ones still queued", () => {
    // Six runs created, four of them finished: the rate is 3 of 4, not 3 of 6.
    const day = runsDay("a", { failed: 1, passed: 3, total: 6 });
    expect(finishedRuns(day)).toBe(4);
    expect(passRate(day)).toBe(0.75);
    expect(passRate(runsDay("a", { passed: 0, total: 3 }))).toBeNull();
    expect(uptimePct({ down: 1, up: 3 })).toBe(75);
    expect(uptimePct({ down: 0, up: 0 })).toBeNull();
  });

  it("reports a series as empty only when every tracked key is zero", () => {
    expect(isEmpty([runsDay("a"), runsDay("b")], ["total", "fallback"])).toBe(true);
    expect(isEmpty([runsDay("a"), runsDay("b", { total: 1 })], ["total"])).toBe(false);
    expect(isEmpty([] as RunsDay[], ["total"])).toBe(true);
  });
});

describe("periodDelta", () => {
  const series = Array.from({ length: 14 }, (_, index) =>
    usersDay(`2026-08-${String(index + 1).padStart(2, "0")}`, index + 1, 0),
  );

  it("compares the last window against the one before it", () => {
    const delta = periodDelta(series, "signups", 7);
    expect(delta).toEqual({ change: 49, comparable: true, current: 77, previous: 28, ratio: 1.75 });
  });

  it("flags a comparison the series is too short to make", () => {
    const delta = periodDelta(series.slice(0, 10), "signups", 7);
    expect(delta.current).toBe(49);
    expect(delta.comparable).toBe(false);
  });

  it("has no ratio to report when the previous window was empty", () => {
    const delta = periodDelta([usersDay("a", 0, 0), usersDay("b", 4, 0)], "signups", 1);
    expect(delta.change).toBe(4);
    expect(delta.ratio).toBeNull();
  });
});

describe("sparkline", () => {
  it("keeps the last n points as label/value pairs", () => {
    const series = Array.from({ length: 20 }, (_, index) => usersDay(`d${index}`, index, index * 2));
    const points = sparkline(series, "cumulative");
    expect(points).toHaveLength(14);
    expect(points[0]).toEqual({ day: "d6", value: 12 });
    expect(sparkline(series, "cumulative", 3)).toHaveLength(3);
  });

  it("returns the whole series when it is shorter than the window", () => {
    expect(sparkline([usersDay("a", 1, 1)], "signups")).toEqual([{ day: "a", value: 1 }]);
  });

  it("pins a fortnight that never moved to the floor of its band", () => {
    // A flat series drawn across the middle of the band reads as activity.
    expect(sparkDomain([{ day: "a", value: 7 }, { day: "b", value: 7 }])).toEqual([7, 8]);
    expect(sparkDomain([{ day: "a", value: 0 }, { day: "b", value: 4 }])).toEqual([0, 4]);
    expect(sparkDomain([])).toEqual([0, 1]);
  });
});

describe("formatters", () => {
  it("compacts token counts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(912)).toBe("912");
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(1_240)).toBe("1.2k");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(124_000)).toBe("124k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });

  it("prints money in whole euros once cents stop mattering", () => {
    expect(formatEuros(0)).toBe("€0");
    expect(formatEuros(12)).toBe("€0.12");
    expect(formatEuros(420)).toBe("€4.20");
    expect(formatEuros(10_000)).toBe("€100");
    expect(formatEuros(117_000)).toBe("€1,170");
  });

  it("shows the arithmetic behind MRR, and nothing when nobody pays", () => {
    expect(mrrBreakdown(117_000, 30)).toBe("€39 × 30");
    expect(mrrBreakdown(0, 0)).toBeNull();
  });

  it("prints a percentage only when there is something to rate", () => {
    expect(formatPct(98.4)).toBe("98%");
    expect(formatPct(null)).toBe("—");
  });

  it("labels UTC days for axes and tooltips", () => {
    expect(formatDayTick("2026-08-23")).toBe("23 Aug");
    expect(formatDayLabel("2026-08-23")).toBe("23 Aug 2026");
    expect(formatDayTick("nonsense")).toBe("nonsense");
  });
});

describe("run series", () => {
  const runs: RunsDay[] = [
    runsDay("2026-08-22", {
      avgDurationMs: 12_000,
      failed: 1,
      inputTokens: 900,
      outputTokens: 100,
      passed: 3,
      total: 4,
    }),
    runsDay("2026-08-23", { fallback: 2, passed: 2, total: 4, timeout: 2 }),
  ];

  it("derives the percentage rail from the daily counts", () => {
    const shaped = runSeries(runs);
    expect(shaped[0]?.passRatePct).toBe(75);
    expect(shaped[0]?.fallbackPct).toBe(0);
    expect(shaped[0]?.tokens).toBe(1_000);
    expect(shaped[1]?.passRatePct).toBe(50);
    expect(shaped[1]?.fallbackPct).toBe(50);
  });

  it("carries what is still running so the column reaches the day's total", () => {
    // Six runs created, two of them still QUEUED or RUNNING.
    const shaped = runSeries([runsDay("2026-08-23", { failed: 1, passed: 3, total: 6 })]);
    expect(shaped[0]?.inProgress).toBe(2);
    // And the rate is over the four that finished, not over all six.
    expect(shaped[0]?.passRatePct).toBe(75);
  });

  it("has no rate to plot on a day with no runs", () => {
    const shaped = runSeries([runsDay("2026-08-23")]);
    expect(shaped[0]?.passRatePct).toBeNull();
    expect(shaped[0]?.fallbackPct).toBeNull();
    expect(shaped[0]?.inProgress).toBe(0);
  });

  it("has no rate to plot on a day where nothing has finished yet", () => {
    const shaped = runSeries([runsDay("2026-08-23", { total: 3 })]);
    expect(shaped[0]?.passRatePct).toBeNull();
    expect(shaped[0]?.inProgress).toBe(3);
  });

  it("only claims a fallback share when a run actually landed on the fallback", () => {
    expect(hasFallback(runs)).toBe(true);
    expect(hasFallback([runsDay("2026-08-23", { total: 4 })])).toBe(false);
  });
});

describe("delivery series", () => {
  const deliveries: DeliveriesDay[] = [
    {
      byChannel: { CALL: 0, DISCORD: 0, EMAIL: 4, PUSH: 1, SLACK: 0, SMS: 2, WHATSAPP: 0 },
      costCents: 130,
      day: "2026-08-23",
    },
  ];

  it("flattens the channel map onto the day so the chart can key straight into it", () => {
    const shaped = deliverySeries(deliveries);
    expect(shaped[0]?.EMAIL).toBe(4);
    expect(shaped[0]?.CALL).toBe(0);
    expect(shaped[0]?.costEuros).toBe(1.3);
  });

  it("ranks the channels that actually delivered, busiest first", () => {
    expect(channelTotals(deliveries)).toEqual([
      { channel: "EMAIL", total: 4 },
      { channel: "SMS", total: 2 },
      { channel: "PUSH", total: 1 },
    ]);
  });

  it("survives a channel the client does not know about yet", () => {
    const shaped = deliverySeries([
      { byChannel: {} as DeliveriesDay["byChannel"], costCents: 0, day: "2026-08-23" },
    ]);
    expect(shaped[0]?.EMAIL).toBe(0);
    expect(channelTotals([])).toEqual([]);
  });
});

describe("check series", () => {
  it("keeps the uptime rail in percent", () => {
    const checks: ChecksDay[] = [{ avgResponseMs: 210, day: "2026-08-23", down: 1, up: 3 }];
    expect(uptimePct(checks[0]!)).toBe(75);
  });
});

describe("fillAnalytics", () => {
  const range = { days: 3, from: "2026-08-21", now: 0, to: "2026-08-23" };

  const ragged = {
    checks: [{ avgResponseMs: 210, day: "2026-08-23", down: 1, up: 3 }],
    deliveries: [
      {
        byChannel: { CALL: 0, DISCORD: 0, EMAIL: 2, PUSH: 0, SLACK: 0, SMS: 0, WHATSAPP: 0 },
        costCents: 12,
        day: "2026-08-23",
      },
    ],
    incidents: [{ day: "2026-08-22", opened: 1, resolved: 0 }],
    range,
    runs: [runsDay("2026-08-23", { passed: 2, total: 2 })],
    users: [usersDay("2026-08-21", 1, 40), usersDay("2026-08-23", 2, 42)],
  } as unknown as Analytics;

  it("pads every series to the range the server said it answered for", () => {
    const filled = fillAnalytics(ragged);

    for (const series of [
      filled.users,
      filled.runs,
      filled.checks,
      filled.incidents,
      filled.deliveries,
    ]) {
      expect(series.map((point) => point.day)).toEqual([
        "2026-08-21",
        "2026-08-22",
        "2026-08-23",
      ]);
    }
    expect(filled.runs[1]).toMatchObject({ passed: 0, total: 0, avgDurationMs: null });
    expect(filled.checks[0]).toMatchObject({ avgResponseMs: null, down: 0, up: 0 });
    expect(filled.deliveries[0]?.byChannel.EMAIL).toBe(0);
  });

  it("carries the account base across a day the payload skipped", () => {
    // A padded day has no total of its own; zero would read as every account
    // disappearing overnight.
    expect(fillAnalytics(ragged).users.map((point) => point.cumulative)).toEqual([40, 40, 42]);
  });
});
