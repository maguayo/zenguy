import type {
  OverviewBrowserCounts,
  OverviewFinishedRun,
  OverviewIncidentEvent,
  OverviewRepo,
  OverviewRunningRun,
  OverviewRunStatus,
  OverviewUptimeCounts,
} from "../../domain/overview/repo";
import type { Clock } from "../../shared/clock";
import type {
  CycleUsage,
  GetCycleUsage,
} from "../billing/get_cycle_usage";

const DAY_MS = 24 * 60 * 60 * 1_000;
const ACTIVITY_LIMIT = 32;
const RECENT_RUN_LIMIT = ACTIVITY_LIMIT;
const RUNNING_RUN_LIMIT = 3;

export type OverviewActivityType =
  | "TEST_PASSED"
  | "TEST_FAILED"
  | "TEST_TIMEOUT"
  | "TEST_SYSTEM_ERROR"
  | "TEST_RECOVERED"
  | "MONITOR_DOWN"
  | "MONITOR_RECOVERED"
  | "CHANNEL_DELIVERY_FAILED";

export type OverviewActivityLink =
  | { runId: string }
  | { incidentId: string }
  | { channelId: string };

export interface OverviewActivityItem {
  id: string;
  type: OverviewActivityType;
  occurredAt: number;
  title: string;
  resourceType: "BROWSER_TEST" | "UPTIME_MONITOR" | "NOTIFICATION_CHANNEL";
  resourceId: string;
  resourceName: string;
  link: OverviewActivityLink;
}

export interface Overview {
  usage: CycleUsage;
  browserTests: OverviewBrowserCounts;
  uptime: OverviewUptimeCounts;
  running: OverviewRunningRun[];
  activity: OverviewActivityItem[];
}

function runActivityType(status: OverviewRunStatus): OverviewActivityType {
  switch (status) {
    case "PASSED":
      return "TEST_PASSED";
    case "FAILED":
      return "TEST_FAILED";
    case "TIMEOUT":
      return "TEST_TIMEOUT";
    case "SYSTEM_ERROR":
      return "TEST_SYSTEM_ERROR";
  }
}

function runActivitySuffix(status: OverviewRunStatus): string {
  switch (status) {
    case "PASSED":
      return "passed";
    case "FAILED":
      return "failed";
    case "TIMEOUT":
      return "timed out";
    case "SYSTEM_ERROR":
      return "had a system error";
  }
}

function runActivity(run: OverviewFinishedRun): OverviewActivityItem {
  return {
    id: run.id,
    type: runActivityType(run.status),
    occurredAt: run.finishedAt,
    title: `${run.testName} ${runActivitySuffix(run.status)}`,
    resourceType: "BROWSER_TEST",
    resourceId: run.browserTestId,
    resourceName: run.testName,
    link: { runId: run.id },
  };
}

function recoveredActivity(
  incident: OverviewIncidentEvent,
): OverviewActivityItem {
  return {
    id: incident.id,
    type:
      incident.resourceType === "BROWSER_TEST"
        ? "TEST_RECOVERED"
        : "MONITOR_RECOVERED",
    occurredAt: incident.occurredAt,
    title: `${incident.resourceName} recovered`,
    resourceType: incident.resourceType,
    resourceId: incident.resourceId,
    resourceName: incident.resourceName,
    link: { incidentId: incident.id },
  };
}

function monitorDownActivity(
  incident: OverviewIncidentEvent,
): OverviewActivityItem {
  return {
    id: incident.id,
    type: "MONITOR_DOWN",
    occurredAt: incident.occurredAt,
    title: `${incident.resourceName} went down`,
    resourceType: "UPTIME_MONITOR",
    resourceId: incident.resourceId,
    resourceName: incident.resourceName,
    link: { incidentId: incident.id },
  };
}

export class GetOverview {
  constructor(
    private readonly getCycleUsage: Pick<GetCycleUsage, "execute">,
    private readonly overview: OverviewRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: { workspaceId: string }): Promise<Overview> {
    const now = this.clock.now();
    const from24h = now - DAY_MS;
    const from30d = now - 30 * DAY_MS;
    const [
      usage,
      browserTests,
      uptime,
      finishedRuns,
      running,
      resolvedIncidents,
      openedUptimeIncidents,
      failedDeliveries,
    ] = await Promise.all([
      this.getCycleUsage.execute(input),
      this.overview.getBrowserCounts(input.workspaceId, from24h, now),
      this.overview.getUptimeCounts(
        input.workspaceId,
        from24h,
        from30d,
        now,
      ),
      this.overview.listFinishedRuns(
        input.workspaceId,
        now,
        RECENT_RUN_LIMIT,
      ),
      this.overview.listRunningRuns(input.workspaceId, RUNNING_RUN_LIMIT),
      this.overview.listResolvedIncidents(
        input.workspaceId,
        from24h,
        now,
        ACTIVITY_LIMIT,
      ),
      this.overview.listOpenedUptimeIncidents(
        input.workspaceId,
        now,
        ACTIVITY_LIMIT,
      ),
      this.overview.listFailedDeliveries(
        input.workspaceId,
        from24h,
        now,
        ACTIVITY_LIMIT,
      ),
    ]);

    const activity: OverviewActivityItem[] = [
      ...finishedRuns.map(runActivity),
      ...resolvedIncidents.map(recoveredActivity),
      ...openedUptimeIncidents.map(monitorDownActivity),
      ...failedDeliveries.map((delivery): OverviewActivityItem => ({
        id: delivery.id,
        type: "CHANNEL_DELIVERY_FAILED",
        occurredAt: delivery.occurredAt,
        title: `Delivery to ${delivery.channelName} failed`,
        resourceType: "NOTIFICATION_CHANNEL",
        resourceId: delivery.channelId,
        resourceName: delivery.channelName,
        link: { channelId: delivery.channelId },
      })),
    ]
      .sort(
        (left, right) =>
          right.occurredAt - left.occurredAt ||
          right.id.localeCompare(left.id),
      )
      .slice(0, ACTIVITY_LIMIT);

    return { usage, browserTests, uptime, running, activity };
  }
}
