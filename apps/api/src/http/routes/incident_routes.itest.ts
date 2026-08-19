import { buildApp } from "../../app";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type {
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import type { Incident, IncidentEvent } from "../../domain/incidents/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1DeliveryRepo } from "../../infrastructure/db/delivery_repo";
import { D1IncidentEventRepo } from "../../infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { freshDb, freshKv, testEnv } from "../../test/helpers";

const NOW = Date.now();
const HOUR_MS = 3_600_000;
const USER: User = {
  id: "usr_incident_reader",
  name: "Incident Reader",
  email: "incident-reader@zenguy.test",
  passwordHash: "unused",
  emailVerifiedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};
const WORKSPACE: Workspace = {
  id: "ws_incident_read",
  name: "Incident Read",
  slug: "incident-read",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const OTHER_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_incident_other",
  name: "Incident Other",
  slug: "incident-other",
};

function browserTest(
  id: string,
  name: string,
  workspaceId = WORKSPACE.id,
): BrowserTest {
  return {
    id,
    workspaceId,
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
    createdAt: NOW - 10 * HOUR_MS,
    updatedAt: NOW - 10 * HOUR_MS,
    deletedAt: null,
  };
}

function incident(input: {
  id: string;
  openedAt: number;
  testId?: string;
  monitorId?: string;
  workspaceId?: string;
}): Incident {
  const browserTestId = input.testId ?? null;
  const uptimeMonitorId = input.monitorId ?? null;
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? WORKSPACE.id,
    resourceType:
      browserTestId === null ? "UPTIME_MONITOR" : "BROWSER_TEST",
    browserTestId,
    uptimeMonitorId,
    status: "OPEN",
    openedAt: input.openedAt,
    resolvedAt: null,
    openedByRunId:
      browserTestId === null ? null : `run_open_${input.id}`,
    resolvedByRunId: null,
    openedByCheckId:
      uptimeMonitorId === null ? null : `check_open_${input.id}`,
    resolvedByCheckId: null,
    lastEventAt: input.openedAt + 1_000,
    createdAt: input.openedAt,
  };
}

function event(
  id: string,
  incidentId: string,
  createdAt: number,
  type: IncidentEvent["type"],
): IncidentEvent {
  return {
    id,
    incidentId,
    type,
    sourceId: `source_${id}`,
    message: `Event ${id}`,
    metadataJson: JSON.stringify({ order: id }),
    createdAt,
  };
}

const RECENT_BROWSER = browserTest("bt_incident_recent", "Checkout flow");
const OLD_BROWSER = browserTest("bt_incident_old", "Legacy flow");
const OTHER_BROWSER = browserTest(
  "bt_incident_other",
  "Other workspace flow",
  OTHER_WORKSPACE.id,
);
const OPEN_BROWSER = incident({
  id: "inc_open_browser",
  testId: RECENT_BROWSER.id,
  openedAt: NOW - 2 * HOUR_MS,
});
const OPEN_UPTIME = incident({
  id: "inc_open_uptime",
  monitorId: "mon_incident_api",
  openedAt: NOW - HOUR_MS,
});
const RESOLVED_BROWSER = incident({
  id: "inc_resolved_browser",
  testId: OLD_BROWSER.id,
  openedAt: NOW - 5 * HOUR_MS,
});
const OTHER_INCIDENT = incident({
  id: "inc_other_workspace",
  testId: OTHER_BROWSER.id,
  workspaceId: OTHER_WORKSPACE.id,
  openedAt: NOW - 30 * 60_000,
});

describe("incident read routes", () => {
  let authorization: string;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    const bindings = testEnv();
    await new D1UserRepo(bindings.DB).insert(USER);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    await workspaces.insert(WORKSPACE);
    await workspaces.insert(OTHER_WORKSPACE);
    await new D1MemberRepo(bindings.DB).insert({
      id: "mem_incident_reader",
      workspaceId: WORKSPACE.id,
      userId: USER.id,
      role: "MEMBER",
      invitedBy: null,
      joinedAt: NOW,
    });
    const tests = new D1BrowserTestRepo(bindings.DB);
    for (const test of [RECENT_BROWSER, OLD_BROWSER, OTHER_BROWSER]) {
      await tests.insert(test);
    }
    const incidents = new D1IncidentRepo(bindings.DB);
    for (const value of [
      OPEN_BROWSER,
      OPEN_UPTIME,
      RESOLVED_BROWSER,
      OTHER_INCIDENT,
    ]) {
      await incidents.insertOpen(value);
    }
    await incidents.resolve(RESOLVED_BROWSER.id, NOW - 4 * HOUR_MS, {
      runId: "run_resolved_browser",
    });
    const events = new D1IncidentEventRepo(bindings.DB);
    for (const value of [
      event(
        "evt_z_tied",
        OPEN_BROWSER.id,
        NOW - 90 * 60_000,
        "FAILURE_RECORDED",
      ),
      event(
        "evt_later",
        OPEN_BROWSER.id,
        NOW - 60 * 60_000,
        "NOTIFICATION_SENT",
      ),
      event(
        "evt_a_tied",
        OPEN_BROWSER.id,
        NOW - 90 * 60_000,
        "OPENED",
      ),
    ]) {
      await events.insert(value);
    }
    const channel: NotificationChannel = {
      id: "ch_incident_ops",
      workspaceId: WORKSPACE.id,
      name: "Ops Slack",
      type: "SLACK",
      encryptedConfig: "encrypted-for-read-only-test",
      enabled: true,
      verifiedAt: NOW - HOUR_MS,
      lastDeliveryStatus: "SENT",
      createdBy: USER.id,
      createdAt: NOW - 10 * HOUR_MS,
      updatedAt: NOW - HOUR_MS,
    };
    await new D1ChannelRepo(bindings.DB).insert(channel);
    const delivery: NotificationDelivery = {
      id: "del_incident_ops",
      workspaceId: WORKSPACE.id,
      incidentId: OPEN_BROWSER.id,
      notificationChannelId: channel.id,
      eventType: "FAILURE",
      status: "SENT",
      providerMessageId: "provider_1",
      attemptCount: 1,
      errorSanitized: null,
      sentAt: NOW - HOUR_MS,
      createdAt: NOW - HOUR_MS - 1_000,
    };
    await new D1DeliveryRepo(bindings.DB).insert(delivery);
    authorization = `Bearer ${await issueAccessToken(
      loadConfig(bindings),
      USER,
      new FixedClock(NOW),
    )}`;
  });

  it("combines status, type, date, and keyset filters for a read-only member", async () => {
    const app = buildApp(testEnv(), { clock: new FixedClock(NOW) });
    const headers = { Authorization: authorization };
    const combined = await app.request(
      `/api/workspaces/${WORKSPACE.id}/incidents?status=open&type=browser&from=${encodeURIComponent(new Date(NOW - 3 * HOUR_MS).toISOString())}&to=${encodeURIComponent(new Date(NOW).toISOString())}`,
      { headers },
    );
    expect(combined.status).toBe(200);
    await expect(combined.json()).resolves.toEqual({
      data: [
        {
          id: OPEN_BROWSER.id,
          resourceType: "BROWSER_TEST",
          resourceId: RECENT_BROWSER.id,
          resourceName: RECENT_BROWSER.name,
          status: "OPEN",
          openedAt: new Date(OPEN_BROWSER.openedAt).toISOString(),
          resolvedAt: null,
          durationMs: NOW - OPEN_BROWSER.openedAt,
          lastEventAt: new Date(OPEN_BROWSER.lastEventAt).toISOString(),
        },
      ],
      nextCursor: null,
    });

    const resolved = await app.request(
      `/api/workspaces/${WORKSPACE.id}/incidents?status=resolved&type=browser`,
      { headers },
    );
    await expect(resolved.json()).resolves.toMatchObject({
      data: [
        {
          id: RESOLVED_BROWSER.id,
          resourceName: OLD_BROWSER.name,
          status: "RESOLVED",
          durationMs: HOUR_MS,
        },
      ],
    });

    const uptime = await app.request(
      `/api/workspaces/${WORKSPACE.id}/incidents?status=open&type=uptime`,
      { headers },
    );
    await expect(uptime.json()).resolves.toMatchObject({
      data: [
        {
          id: OPEN_UPTIME.id,
          resourceType: "UPTIME_MONITOR",
          resourceId: OPEN_UPTIME.uptimeMonitorId,
          resourceName: "Deleted uptime monitor",
        },
      ],
    });

    const first = await app.request(
      `/api/workspaces/${WORKSPACE.id}/incidents?limit=1`,
      { headers },
    );
    const firstBody = (await first.json()) as {
      data: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstBody).toMatchObject({
      data: [{ id: OPEN_UPTIME.id }],
      nextCursor: expect.any(String),
    });
    const second = await app.request(
      `/api/workspaces/${WORKSPACE.id}/incidents?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      { headers },
    );
    await expect(second.json()).resolves.toMatchObject({
      data: [{ id: OPEN_BROWSER.id }],
    });
  });

  it("returns the ordered timeline and joined delivery, and scopes detail reads", async () => {
    const app = buildApp(testEnv(), { clock: new FixedClock(NOW) });
    const headers = { Authorization: authorization };
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/incidents/${OPEN_BROWSER.id}`,
      { headers },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        resourceName: string;
        openedByRunId: string | null;
        openedByCheckId: string | null;
        events: Array<{
          id: string;
          metadata: Record<string, unknown> | null;
          createdAt: string;
        }>;
        deliveries: Array<{
          id: string;
          channelName: string;
          channelType: string;
          sentAt: string | null;
        }>;
      };
    };
    expect(body.data).toMatchObject({
      resourceName: RECENT_BROWSER.name,
      openedByRunId: OPEN_BROWSER.openedByRunId,
      openedByCheckId: null,
      deliveries: [
        {
          id: "del_incident_ops",
          channelName: "Ops Slack",
          channelType: "SLACK",
          eventType: "FAILURE",
          status: "SENT",
          attemptCount: 1,
          errorSanitized: null,
          sentAt: new Date(NOW - HOUR_MS).toISOString(),
          createdAt: new Date(NOW - HOUR_MS - 1_000).toISOString(),
        },
      ],
    });
    expect(body.data.events.map(({ id }) => id)).toEqual([
      "evt_a_tied",
      "evt_z_tied",
      "evt_later",
    ]);
    expect(body.data.events[0]?.metadata).toEqual({ order: "evt_a_tied" });
    expect(body.data.events[0]?.createdAt).toBe(
      new Date(NOW - 90 * 60_000).toISOString(),
    );

    const crossWorkspace = await app.request(
      `/api/workspaces/${WORKSPACE.id}/incidents/${OTHER_INCIDENT.id}`,
      { headers },
    );
    expect(crossWorkspace.status).toBe(404);
    await expect(crossWorkspace.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "Incident not found" },
    });
  });
});
