import { DAY_MS, dailyDowntime, uptimePercent } from "./availability";

// 2026-08-30T12:00:00.000Z — midday UTC so day-boundary math is visible.
const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);
const TODAY_START = Date.UTC(2026, 7, 30);
const OLD_CREATED = NOW - 200 * DAY_MS;

describe("dailyDowntime", () => {
  it("returns one zeroed entry per day, oldest first, ending today (UTC)", () => {
    const days = dailyDowntime([], NOW, 90, OLD_CREATED);
    expect(days).toHaveLength(90);
    expect(days.at(-1)?.date).toBe("2026-08-30");
    expect(days[0]?.date).toBe("2026-06-02");
    expect(days.every((day) => day.downtimeSeconds === 0)).toBe(true);
    expect(days.every((day) => day.hasData)).toBe(true);
  });

  it("marks days before the resource existed as no-data", () => {
    const createdAt = NOW - 2 * DAY_MS; // two days ago, midday
    const days = dailyDowntime([], NOW, 90, createdAt);
    expect(days.at(-1)?.hasData).toBe(true);
    expect(days.at(-2)?.hasData).toBe(true);
    expect(days.at(-3)?.hasData).toBe(true); // creation day itself has data
    expect(days.at(-4)?.hasData).toBe(false);
    expect(days.slice(0, 86).every((day) => !day.hasData)).toBe(true);
  });

  it("adds a resolved incident's seconds to its day only", () => {
    const openedAt = TODAY_START - 3 * DAY_MS + 2 * 3_600_000;
    const incidents = [{ openedAt, resolvedAt: openedAt + 90 * 60_000 }];
    const days = dailyDowntime(incidents, NOW, 90, OLD_CREATED);
    expect(days.at(-4)?.downtimeSeconds).toBe(90 * 60);
    expect(days.at(-3)?.downtimeSeconds).toBe(0);
    expect(days.at(-5)?.downtimeSeconds).toBe(0);
  });

  it("splits an incident spanning midnight across both days", () => {
    const openedAt = TODAY_START - 30 * 60_000; // 23:30 yesterday
    const incidents = [{ openedAt, resolvedAt: TODAY_START + 45 * 60_000 }];
    const days = dailyDowntime(incidents, NOW, 90, OLD_CREATED);
    expect(days.at(-2)?.downtimeSeconds).toBe(30 * 60);
    expect(days.at(-1)?.downtimeSeconds).toBe(45 * 60);
  });

  it("accrues an open incident up to now", () => {
    const incidents = [{ openedAt: NOW - 2 * 3_600_000, resolvedAt: null }];
    const days = dailyDowntime(incidents, NOW, 90, OLD_CREATED);
    expect(days.at(-1)?.downtimeSeconds).toBe(2 * 3_600);
  });

  it("clamps a day's downtime at 86400 seconds", () => {
    const incidents = [
      { openedAt: TODAY_START - 5 * DAY_MS, resolvedAt: null },
      { openedAt: TODAY_START - 5 * DAY_MS, resolvedAt: null },
    ];
    const days = dailyDowntime(incidents, NOW, 90, OLD_CREATED);
    expect(days.at(-2)?.downtimeSeconds).toBe(86_400);
  });

  it("ignores incidents entirely before the window", () => {
    const incidents = [
      { openedAt: NOW - 200 * DAY_MS, resolvedAt: NOW - 199 * DAY_MS },
    ];
    const days = dailyDowntime(incidents, NOW, 90, OLD_CREATED);
    expect(days.every((day) => day.downtimeSeconds === 0)).toBe(true);
  });
});

describe("uptimePercent", () => {
  it("computes the percentage over the full window", () => {
    const incidents = [
      { openedAt: NOW - 10 * DAY_MS, resolvedAt: NOW - 10 * DAY_MS + 3_600_000 },
    ];
    expect(uptimePercent(incidents, NOW, 90, OLD_CREATED)).toBe(99.95);
  });

  it("uses the resource age when younger than the window", () => {
    const createdAt = NOW - DAY_MS / 2; // 12 hours old
    const incidents = [
      { openedAt: NOW - 6 * 3_600_000, resolvedAt: null }, // 6h down, ongoing
    ];
    expect(uptimePercent(incidents, NOW, 90, createdAt)).toBe(50);
  });

  it("returns null for a brand-new resource", () => {
    expect(uptimePercent([], NOW, 90, NOW)).toBeNull();
    expect(uptimePercent([], NOW, 90, NOW + 1_000)).toBeNull();
  });

  it("is 100 with no incidents", () => {
    expect(uptimePercent([], NOW, 90, OLD_CREATED)).toBe(100);
  });
});
