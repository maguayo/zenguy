import { buildApp } from "../../app";
import type { Subscription, UsageEvent } from "../../domain/billing/types";
import type {
  BrowserTest,
  RunSnapshot,
  RunSource,
  RunStatus,
  TestRun,
} from "../../domain/browser_tests/types";
import type {
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import type { Incident } from "../../domain/incidents/types";
import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1CheckRepo } from "../../infrastructure/db/check_repo";
import { D1DeliveryRepo } from "../../infrastructure/db/delivery_repo";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UsageEventRepo } from "../../infrastructure/db/usage_event_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock, systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { encryptTestValue, freshDb, testEnv } from "../../test/helpers";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;
const USER: User = {
  id: "usr_overview_member",
  name: "Overview Member",
  email: "overview@zenguy.test",
  passwordHash: "unused",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const WORKSPACE: Workspace = {
  id: "ws_overview",
  name: "Overview Workspace",
  slug: "overview-workspace",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: NOW - 30 * 24 * HOUR_MS,
  updatedAt: NOW,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_overview",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_overview",
  providerSubscriptionId: "provider_sub_overview",
  status: "ACTIVE",
  periodStart: Date.parse("2026-08-01T00:00:00.000Z"),
  periodEnd: Date.parse("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function browserTest(
  id: string,
  name: string,
  deletedAt: number | null = null,
): BrowserTest {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    startUrl: "https://example.com",
    instructions: "Check the page",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 1,
    notifyOnRecovery: true,
    nextRunAt: NOW + HOUR_MS,
    createdBy: USER.id,
    updatedBy: USER.id,
    createdAt: NOW - 20 * HOUR_MS,
    updatedAt: NOW,
    deletedAt,
  };
}

const TESTS = {
  checkout: browserTest("bt_overview_checkout", "Checkout flow"),
  search: browserTest("bt_overview_search", "Search flow"),
  account: browserTest("bt_overview_account", "Account flow"),
  deleted: browserTest(
    "bt_overview_deleted",
    "Deleted flow",
    NOW - HOUR_MS,
  ),
};

function snapshot(name: string): RunSnapshot {
  return {
    name,
    startUrl: "https://example.com",
    instructions: "Check the page",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 1,
    notifyOnRecovery: true,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: "overview-test",
  };
}

function testRun(input: {
  id: string;
  testId: string | null;
  name: string;
  source?: RunSource;
  status: RunStatus;
  finishedAt: number | null;
}): TestRun {
  return {
    id: input.id,
    workspaceId: WORKSPACE.id,
    browserTestId: input.testId,
    source: input.source ?? "MANUAL",
    status: input.status,
    snapshot: snapshot(input.name),
    scheduledFor: null,
    queuedAt: (input.finishedAt ?? NOW) - 60_000,
    startedAt: (input.finishedAt ?? NOW) - 30_000,
    finishedAt: input.finishedAt,
    durationMs: input.finishedAt === null ? null : 30_000,
    attemptCount: input.finishedAt === null ? 0 : 1,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: input.source !== "VALIDATION",
    usageEventId: null,
    triggeredByUserId: USER.id,
    incidentId: null,
    createdAt: (input.finishedAt ?? NOW) - 60_000,
  };
}

function monitor(
  id: string,
  name: string,
  status: UptimeMonitor["currentStatus"],
  deletedAt: number | null = null,
): UptimeMonitor {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
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
    maxRetries: 1,
    notifyOnRecovery: true,
    nextCheckAt: NOW + HOUR_MS,
    currentStatus: status,
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: NOW - HOUR_MS,
    lastResponseTimeMs: 200,
    createdBy: USER.id,
    createdAt: NOW - 20 * HOUR_MS,
    updatedAt: NOW,
    deletedAt,
  };
}

const MONITORS = {
  api: monitor("mon_overview_api", "Public API", "UP"),
  site: monitor("mon_overview_site", "Marketing site", "DOWN"),
  docs: monitor("mon_overview_docs", "Documentation", "UNKNOWN"),
  deleted: monitor(
    "mon_overview_deleted",
    "Deleted monitor",
    "DOWN",
    NOW - HOUR_MS,
  ),
};

function check(
  id: string,
  monitorId: string,
  checkedAt: number,
  responseTimeMs: number | null,
): UptimeCheck {
  return {
    id,
    workspaceId: WORKSPACE.id,
    uptimeMonitorId: monitorId,
    cycleId: `cycle_${id}`,
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

function incident(input: {
  id: string;
  openedAt: number;
  browserTestId?: string;
  uptimeMonitorId?: string;
}): Incident {
  const browserTestId = input.browserTestId ?? null;
  const uptimeMonitorId = input.uptimeMonitorId ?? null;
  return {
    id: input.id,
    workspaceId: WORKSPACE.id,
    resourceType:
      browserTestId === null ? "UPTIME_MONITOR" : "BROWSER_TEST",
    browserTestId,
    uptimeMonitorId,
    status: "OPEN",
    openedAt: input.openedAt,
    resolvedAt: null,
    openedByRunId: browserTestId === null ? null : `run_${input.id}`,
    resolvedByRunId: null,
    openedByCheckId: uptimeMonitorId === null ? null : `check_${input.id}`,
    resolvedByCheckId: null,
    lastEventAt: input.openedAt,
    createdAt: input.openedAt,
  };
}

describe("overview route", () => {
  it("returns member-visible counts and a merged, typed activity feed", async () => {
    await freshDb();
    const bindings = testEnv();
    const clock = new FixedClock(NOW);
    await new D1UserRepo(bindings.DB).insert(USER);
    await new D1WorkspaceRepo(bindings.DB).insert(WORKSPACE);
    await new D1MemberRepo(bindings.DB).insert({
      id: "mem_overview",
      workspaceId: WORKSPACE.id,
      userId: USER.id,
      role: "MEMBER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    const usage: UsageEvent = {
      id: "usage_overview",
      workspaceId: WORKSPACE.id,
      testRunId: "run_usage_overview",
      type: "BROWSER_RUN",
      quantity: 4,
      billable: true,
      idempotencyKey: "overview-usage",
      occurredAt: NOW - HOUR_MS,
      reversedAt: null,
      createdAt: NOW - HOUR_MS,
    };
    await new D1UsageEventRepo(bindings.DB).insertIfAbsent(usage);

    const tests = new D1BrowserTestRepo(bindings.DB);
    for (const value of Object.values(TESTS)) await tests.insert(value);
    const runs = new D1RunRepo(bindings.DB);
    for (const value of [
      testRun({
        id: "run_overview_running",
        testId: TESTS.checkout.id,
        name: TESTS.checkout.name,
        status: "RUNNING",
        finishedAt: null,
      }),
      testRun({
        id: "run_overview_validation_running",
        testId: null,
        name: "Draft validation",
        source: "VALIDATION",
        status: "RUNNING",
        finishedAt: null,
      }),
      testRun({
        id: "run_overview_passed",
        testId: TESTS.checkout.id,
        name: TESTS.checkout.name,
        status: "PASSED",
        finishedAt: NOW - 8 * HOUR_MS,
      }),
      testRun({
        id: "run_overview_failed",
        testId: TESTS.search.id,
        name: TESTS.search.name,
        status: "FAILED",
        finishedAt: NOW - 7 * HOUR_MS,
      }),
      testRun({
        id: "run_overview_timeout",
        testId: TESTS.account.id,
        name: TESTS.account.name,
        source: "SCHEDULED",
        status: "TIMEOUT",
        finishedAt: NOW - 6 * HOUR_MS,
      }),
      testRun({
        id: "run_overview_system",
        testId: TESTS.account.id,
        name: TESTS.account.name,
        status: "SYSTEM_ERROR",
        finishedAt: NOW - 5 * HOUR_MS,
      }),
      testRun({
        id: "run_overview_validation_failed",
        testId: null,
        name: "Draft validation",
        source: "VALIDATION",
        status: "FAILED",
        finishedAt: NOW - 4 * HOUR_MS,
      }),
      testRun({
        id: "run_overview_old_failed",
        testId: TESTS.search.id,
        name: TESTS.search.name,
        status: "FAILED",
        finishedAt: NOW - 25 * HOUR_MS,
      }),
      testRun({
        id: "run_overview_future_failed",
        testId: TESTS.search.id,
        name: TESTS.search.name,
        status: "FAILED",
        finishedAt: NOW + HOUR_MS,
      }),
    ]) {
      await runs.insert(value);
    }

    const monitors = new D1MonitorRepo(bindings.DB);
    for (const value of Object.values(MONITORS)) await monitors.insert(value);
    const checks = new D1CheckRepo(bindings.DB);
    for (const value of [
      check("check_overview_fast", MONITORS.api.id, NOW - HOUR_MS, 100),
      check("check_overview_slow", MONITORS.site.id, NOW - 2 * HOUR_MS, 300),
      check("check_overview_null", MONITORS.docs.id, NOW - 3 * HOUR_MS, null),
      check("check_overview_old", MONITORS.api.id, NOW - 25 * HOUR_MS, 900),
    ]) {
      await checks.insertIfAbsent(value);
    }

    const incidents = new D1IncidentRepo(bindings.DB);
    await incidents.insertOpen(
      incident({
        id: "inc_overview_browser_open",
        browserTestId: TESTS.search.id,
        openedAt: NOW - 10 * HOUR_MS,
      }),
    );
    await incidents.insertOpen(
      incident({
        id: "inc_overview_browser_recovered",
        browserTestId: TESTS.checkout.id,
        openedAt: NOW - 12 * HOUR_MS,
      }),
    );
    await incidents.resolve(
      "inc_overview_browser_recovered",
      NOW - 4 * HOUR_MS,
      { runId: "run_overview_passed" },
    );
    await incidents.insertOpen(
      incident({
        id: "inc_overview_uptime_open",
        uptimeMonitorId: MONITORS.site.id,
        openedAt: NOW - 3 * HOUR_MS,
      }),
    );
    await incidents.insertOpen(
      incident({
        id: "inc_overview_uptime_recovered",
        uptimeMonitorId: MONITORS.api.id,
        openedAt: NOW - 9 * HOUR_MS,
      }),
    );
    await incidents.resolve(
      "inc_overview_uptime_recovered",
      NOW - 2 * HOUR_MS,
      { checkId: "check_overview_fast" },
    );

    const channel: NotificationChannel = {
      id: "channel_overview_ops",
      workspaceId: WORKSPACE.id,
      name: "Ops Slack",
      type: "SLACK",
      encryptedConfig: await encryptTestValue({
        type: "notification_channel",
        workspaceId: WORKSPACE.id,
        recordId: "channel_overview_ops",
      }),
      enabled: true,
      verifiedAt: NOW,
      lastDeliveryStatus: "FAILED",
      createdBy: USER.id,
      createdAt: NOW - 20 * HOUR_MS,
      updatedAt: NOW,
    };
    await new D1ChannelRepo(bindings.DB).insert(channel);
    const deliveries = new D1DeliveryRepo(bindings.DB);
    const delivery = (
      id: string,
      status: NotificationDelivery["status"],
      createdAt: number,
    ): NotificationDelivery => ({
      id,
      workspaceId: WORKSPACE.id,
      incidentId: "inc_overview_uptime_open",
      notificationChannelId: channel.id,
      eventType: "FAILURE",
      status,
      providerMessageId: null,
      attemptCount: 1,
      errorSanitized: status === "FAILED" ? "Provider unavailable" : null,
      sentAt: status === "SENT" ? createdAt : null,
      createdAt,
    });
    for (const value of [
      delivery("delivery_overview_failed", "FAILED", NOW - HOUR_MS),
      delivery("delivery_overview_old", "FAILED", NOW - 25 * HOUR_MS),
      delivery("delivery_overview_sent", "SENT", NOW - 30 * 60_000),
    ]) {
      await deliveries.insert(value);
    }

    const token = await issueAccessToken(
      loadConfig(bindings),
      USER,
      systemClock,
    );
    const app = buildApp(bindings, { clock });
    const unauthorized = await app.request(
      `/api/workspaces/${WORKSPACE.id}/overview`,
    );
    expect(unauthorized.status).toBe(401);

    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/overview`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        activity: Array<{ id: string; type: string; occurredAt: string }>;
      };
    };
    expect(body).toMatchObject({
      data: {
        usage: {
          periodStart: "2026-08-01T00:00:00.000Z",
          periodEnd: "2026-09-01T00:00:00.000Z",
          billableRuns: 4,
          includedRuns: 300,
          remainingRuns: 296,
          overageRuns: 0,
          overageAmountCents: 0,
          projectedTotalCents: 3_900,
        },
        browserTests: {
          total: 3,
          runningRuns: 2,
          openIncidents: 1,
          failed24h: 2,
        },
        uptime: {
          up: 1,
          down: 1,
          unknown: 1,
          openIncidents: 1,
          avgResponseTimeMs24h: 200,
        },
        running: [
          {
            id: "run_overview_validation_running",
            browserTestId: null,
            testName: "Draft validation",
            startedAt: "2026-08-19T11:59:30.000Z",
          },
          {
            id: "run_overview_running",
            browserTestId: TESTS.checkout.id,
            testName: TESTS.checkout.name,
            startedAt: "2026-08-19T11:59:30.000Z",
          },
        ],
      },
    });
    expect(body.data.activity.map(({ id }) => id)).toEqual([
      "delivery_overview_failed",
      "inc_overview_uptime_recovered",
      "inc_overview_uptime_open",
      "inc_overview_browser_recovered",
      "run_overview_system",
      "run_overview_timeout",
      "run_overview_failed",
      "run_overview_passed",
      "inc_overview_uptime_recovered",
      "run_overview_old_failed",
    ]);
    expect(body.data.activity.map(({ type }) => type)).toEqual([
      "CHANNEL_DELIVERY_FAILED",
      "MONITOR_RECOVERED",
      "MONITOR_DOWN",
      "TEST_RECOVERED",
      "TEST_SYSTEM_ERROR",
      "TEST_TIMEOUT",
      "TEST_FAILED",
      "TEST_PASSED",
      "MONITOR_DOWN",
      "TEST_FAILED",
    ]);
    expect(
      body.data.activity.map(({ occurredAt }) => Date.parse(occurredAt)),
    ).toEqual(
      [...body.data.activity]
        .map(({ occurredAt }) => Date.parse(occurredAt))
        .sort((left, right) => right - left),
    );
    expect(body.data.activity).toHaveLength(10);
    expect(body.data.activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "run_overview_timeout",
          title: "Account flow timed out",
          resourceType: "BROWSER_TEST",
          resourceId: TESTS.account.id,
          resourceName: TESTS.account.name,
          link: { runId: "run_overview_timeout" },
        }),
        expect.objectContaining({
          id: "delivery_overview_failed",
          title: "Delivery to Ops Slack failed",
          resourceType: "NOTIFICATION_CHANNEL",
          resourceId: channel.id,
          resourceName: channel.name,
          link: { channelId: channel.id },
        }),
      ]),
    );
  });
});
