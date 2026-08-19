import type {
  OverviewFailedDelivery,
  OverviewFinishedRun,
  OverviewIncidentEvent,
  OverviewRepo,
} from "../../domain/overview/repo";
import { FixedClock } from "../../shared/clock";
import { GetOverview } from "./get_overview";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;

class RecordingOverviewRepo implements OverviewRepo {
  finishedRuns: OverviewFinishedRun[] = [];
  resolvedIncidents: OverviewIncidentEvent[] = [];
  openedUptimeIncidents: OverviewIncidentEvent[] = [];
  failedDeliveries: OverviewFailedDelivery[] = [];
  requestedRunLimit: number | null = null;

  async getBrowserCounts() {
    return {
      total: 3,
      runningRuns: 2,
      openIncidents: 1,
      failed24h: 4,
    };
  }

  async getUptimeCounts() {
    return {
      up: 2,
      down: 1,
      unknown: 3,
      openIncidents: 1,
      avgResponseTimeMs24h: 125.5,
    };
  }

  async listFinishedRuns(
    _workspaceId: string,
    _toMs: number,
    limit: number,
  ) {
    this.requestedRunLimit = limit;
    return this.finishedRuns;
  }

  async listResolvedIncidents() {
    return this.resolvedIncidents;
  }

  async listOpenedUptimeIncidents() {
    return this.openedUptimeIncidents;
  }

  async listFailedDeliveries() {
    return this.failedDeliveries;
  }
}

const usage = {
  periodStart: Date.parse("2026-08-01T00:00:00.000Z"),
  periodEnd: Date.parse("2026-09-01T00:00:00.000Z"),
  billableRuns: 7,
  includedRuns: 300,
  remainingRuns: 293,
  overageRuns: 0,
  overageAmountCents: 0,
  projectedTotalCents: 3_900,
};

describe("GetOverview", () => {
  it("assembles every activity type with exact titles and newest-first order", async () => {
    const repo = new RecordingOverviewRepo();
    repo.finishedRuns = [
      {
        id: "run_passed",
        browserTestId: "bt_checkout",
        status: "PASSED",
        testName: "Checkout",
        finishedAt: NOW - 8 * HOUR_MS,
      },
      {
        id: "run_failed",
        browserTestId: "bt_search",
        status: "FAILED",
        testName: "Search",
        finishedAt: NOW - 7 * HOUR_MS,
      },
      {
        id: "run_timeout",
        browserTestId: "bt_login",
        status: "TIMEOUT",
        testName: "Login",
        finishedAt: NOW - 6 * HOUR_MS,
      },
      {
        id: "run_system",
        browserTestId: "bt_account",
        status: "SYSTEM_ERROR",
        testName: "Account",
        finishedAt: NOW - 5 * HOUR_MS,
      },
    ];
    repo.resolvedIncidents = [
      {
        id: "inc_test_recovered",
        resourceType: "BROWSER_TEST",
        resourceId: "bt_checkout",
        resourceName: "Checkout",
        occurredAt: NOW - 4 * HOUR_MS,
      },
      {
        id: "inc_monitor_recovered",
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_api",
        resourceName: "Public API",
        occurredAt: NOW - 3 * HOUR_MS,
      },
    ];
    repo.openedUptimeIncidents = [
      {
        id: "inc_monitor_down",
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_api",
        resourceName: "Public API",
        occurredAt: NOW - 2 * HOUR_MS,
      },
    ];
    repo.failedDeliveries = [
      {
        id: "delivery_failed",
        channelId: "channel_ops",
        channelName: "Ops Slack",
        occurredAt: NOW - HOUR_MS,
      },
    ];
    const service = new GetOverview(
      { execute: async () => usage },
      repo,
      new FixedClock(NOW),
    );

    const result = await service.execute({ workspaceId: "ws_overview" });

    expect(result).toMatchObject({
      usage,
      browserTests: {
        total: 3,
        runningRuns: 2,
        openIncidents: 1,
        failed24h: 4,
      },
      uptime: {
        up: 2,
        down: 1,
        unknown: 3,
        openIncidents: 1,
        avgResponseTimeMs24h: 125.5,
      },
    });
    expect(repo.requestedRunLimit).toBe(15);
    expect(result.activity.map((item) => item.type)).toEqual([
      "CHANNEL_DELIVERY_FAILED",
      "MONITOR_DOWN",
      "MONITOR_RECOVERED",
      "TEST_RECOVERED",
      "TEST_SYSTEM_ERROR",
      "TEST_TIMEOUT",
      "TEST_FAILED",
      "TEST_PASSED",
    ]);
    expect(result.activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "run_passed",
          title: "Checkout passed",
          resourceType: "BROWSER_TEST",
          resourceId: "bt_checkout",
          resourceName: "Checkout",
          link: { runId: "run_passed" },
        }),
        expect.objectContaining({
          id: "run_failed",
          title: "Search failed",
        }),
        expect.objectContaining({
          id: "run_timeout",
          title: "Login timed out",
        }),
        expect.objectContaining({
          id: "run_system",
          title: "Account had a system error",
        }),
        expect.objectContaining({
          id: "inc_monitor_down",
          title: "Public API went down",
          link: { incidentId: "inc_monitor_down" },
        }),
        expect.objectContaining({
          id: "delivery_failed",
          title: "Delivery to Ops Slack failed",
          link: { channelId: "channel_ops" },
        }),
      ]),
    );
  });

  it("uses deterministic tie ordering and caps merged activity at twenty", async () => {
    const repo = new RecordingOverviewRepo();
    repo.finishedRuns = Array.from({ length: 15 }, (_, index) => ({
      id: `run_${String(index).padStart(2, "0")}`,
      browserTestId: "bt_limit",
      status: "PASSED" as const,
      testName: "Limit test",
      finishedAt: NOW - HOUR_MS,
    }));
    repo.openedUptimeIncidents = Array.from(
      { length: 10 },
      (_, index) => ({
        id: `incident_${String(index).padStart(2, "0")}`,
        resourceType: "UPTIME_MONITOR" as const,
        resourceId: "mon_limit",
        resourceName: "Limit monitor",
        occurredAt: NOW - HOUR_MS,
      }),
    );
    const service = new GetOverview(
      { execute: async () => usage },
      repo,
      new FixedClock(NOW),
    );

    const result = await service.execute({ workspaceId: "ws_overview" });

    expect(result.activity).toHaveLength(20);
    expect(result.activity.map((item) => item.id)).toEqual(
      [...repo.finishedRuns, ...repo.openedUptimeIncidents]
        .map((item) => item.id)
        .sort((left, right) => right.localeCompare(left))
        .slice(0, 20),
    );
  });
});
