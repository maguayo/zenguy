import type { Incident } from "../../domain/incidents/types";
import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import { FixedClock } from "../../shared/clock";
import { FakeIncidentRepo } from "../../test/fakes/incident_repos";
import { FakeCheckRepo, FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import { GetMonitorStats } from "./get_monitor_stats";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = 40 * DAY_MS;

function monitor(overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
  return {
    id: "mon_stats",
    workspaceId: "ws_stats",
    name: "Stats monitor",
    url: "https://example.com/health",
    method: "GET",
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt: NOW,
    currentStatus: "UP",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: "usr_stats",
    createdAt: NOW - 31 * DAY_MS,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function check(id: string, checkedAt: number, responseTimeMs: number): UptimeCheck {
  return {
    id,
    workspaceId: "ws_stats",
    uptimeMonitorId: "mon_stats",
    cycleId: `cyc_${id}`,
    attemptIndex: 0,
    status: "PASSED",
    httpStatus: 200,
    responseTimeMs,
    failureReason: null,
    responseExcerpt: null,
    checkedAt,
    createdAt: checkedAt,
  };
}

function incident(
  id: string,
  openedAt: number,
  resolvedAt: number | null,
): Incident {
  return {
    id,
    workspaceId: "ws_stats",
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: "mon_stats",
    status: resolvedAt === null ? "OPEN" : "RESOLVED",
    openedAt,
    resolvedAt,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: `chk_${id}`,
    resolvedByCheckId: resolvedAt === null ? null : `chk_resolved_${id}`,
    lastEventAt: resolvedAt ?? openedAt,
    createdAt: openedAt,
  };
}

async function setup(value = monitor()) {
  const monitors = new FakeMonitorRepo();
  const checks = new FakeCheckRepo();
  const incidents = new FakeIncidentRepo();
  await monitors.insert(value);
  return {
    monitors,
    checks,
    incidents,
    stats: new GetMonitorStats(
      monitors,
      checks,
      incidents,
      new FixedClock(NOW),
    ),
  };
}

describe("GetMonitorStats", () => {
  it("sums incident overlap at window edges, resolved intervals, and an open interval", async () => {
    const context = await setup();
    context.incidents.incidents.set(
      "inc_edge",
      incident("inc_edge", NOW - 25 * HOUR_MS, NOW - 23 * HOUR_MS),
    );
    context.incidents.incidents.set(
      "inc_middle",
      incident("inc_middle", NOW - 6 * HOUR_MS, NOW - 5 * HOUR_MS),
    );
    context.incidents.incidents.set(
      "inc_open",
      incident("inc_open", NOW - 2 * HOUR_MS, null),
    );
    await context.checks.insertIfAbsent(check("chk_fast", NOW - HOUR_MS, 100));
    await context.checks.insertIfAbsent(check("chk_slow", NOW - 1_000, 300));

    await expect(
      context.stats.execute({ workspaceId: "ws_stats", monitorId: "mon_stats" }),
    ).resolves.toMatchObject({
      uptime24h: 83.33,
      uptime7d: 97.02,
      uptime30d: 99.31,
      avgResponseTimeMs24h: 200,
    });
  });

  it("downsamples the last 24 hours evenly to 288 points including both ends", async () => {
    const context = await setup();
    const first = NOW - 500_000;
    for (let index = 0; index < 500; index += 1) {
      await context.checks.insertIfAbsent(
        check(`chk_${String(index).padStart(3, "0")}`, first + index * 1_000, index),
      );
    }

    const result = await context.stats.execute({
      workspaceId: "ws_stats",
      monitorId: "mon_stats",
    });
    expect(result.series).toHaveLength(288);
    expect(result.series[0]?.t).toBe(first);
    expect(result.series.at(-1)?.t).toBe(first + 499_000);
    const gaps = result.series.slice(1).map(
      (point, index) => point.t - (result.series[index]?.t ?? point.t),
    );
    expect(Math.min(...gaps)).toBe(1_000);
    expect(Math.max(...gaps)).toBe(2_000);
  });

  it("returns null percentages for a young monitor with no checks", async () => {
    const context = await setup(monitor({ createdAt: NOW - HOUR_MS }));
    await expect(
      context.stats.execute({ workspaceId: "ws_stats", monitorId: "mon_stats" }),
    ).resolves.toEqual({
      uptime24h: null,
      uptime7d: null,
      uptime30d: null,
      avgResponseTimeMs24h: null,
      series: [],
    });
  });
});
