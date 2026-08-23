import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { CheckOutcome } from "../../application/uptime/execute_check";
import type { Subscription } from "../../domain/billing/types";
import type { NotificationChannel } from "../../domain/channels/types";
import type { Incident } from "../../domain/incidents/types";
import type { MonitorConfig } from "../../domain/uptime/rules";
import type { UptimeCheck } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1CheckRepo } from "../../infrastructure/db/check_repo";
import { D1IncidentEventRepo } from "../../infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { encryptSecret } from "../../shared/crypto";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";
const NOW = Date.now();
const RAW_HEADER = "Bearer raw-uptime-token";
const RAW_BODY = '{"probe":"raw-uptime-body"}';
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_uptime_owner",
    name: "Uptime Owner",
    email: "uptime-owner@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  admin: {
    id: "usr_uptime_admin",
    name: "Uptime Admin",
    email: "uptime-admin@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  member: {
    id: "usr_uptime_member",
    name: "Uptime Member",
    email: "uptime-member@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
};
const ROLES: Record<Actor, Role> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};
const WORKSPACE: Workspace = {
  id: "ws_uptime_routes",
  name: "Uptime Routes",
  slug: "uptime-routes",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_uptime_routes",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_uptime_routes",
  providerSubscriptionId: "provider_sub_uptime_routes",
  status: "ACTIVE",
  periodStart: NOW - 86_400_000,
  periodEnd: NOW + 30 * 86_400_000,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const CONFIG = {
  name: "Payments API",
  url: "https://api.example.com/payments/health",
  method: "POST",
  headers: [{ key: "Authorization", value: RAW_HEADER }],
  body: RAW_BODY,
  expectedStatus: 201,
  bodyCondition: "CONTAINS",
  bodyExpectedValue: "healthy",
  bodyConditionPath: null,
  frequencySeconds: 300,
  timeoutSeconds: 12,
  maxRetries: 2,
  notifyOnRecovery: false,
  channelIds: ["ch_uptime_routes"],
} as const;

function channel(encryptedConfig: string): NotificationChannel {
  return {
    id: "ch_uptime_routes",
    workspaceId: WORKSPACE.id,
    name: "Uptime email",
    type: "EMAIL",
    encryptedConfig,
    enabled: true,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: USERS.owner.id,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const TEST_OUTCOME: CheckOutcome = {
  status: "PASSED",
  httpStatus: 204,
  responseTimeMs: 31,
  failureReason: null,
  responseExcerpt: null,
  conditions: [
    { type: "status", passed: true, detail: "expected 204, got 204" },
  ],
};

describe("uptime monitor routes", () => {
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;
  let monitors: D1MonitorRepo;
  let checks: D1CheckRepo;
  let incidents: D1IncidentRepo;
  let events: D1IncidentEventRepo;
  let audits: D1AuditRepo;
  let executorCalls: MonitorConfig[];

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_uptime_routes_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: NOW + sequence,
      });
    }
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    const encryptedEmail = await encryptSecret(
      JSON.stringify({ emails: ["ops@example.com"] }),
      config.encryptionKeys,
      {
        type: "notification_channel",
        workspaceId: WORKSPACE.id,
        recordId: "ch_uptime_routes",
      },
    );
    await new D1ChannelRepo(bindings.DB).insert(channel(encryptedEmail));
    monitors = new D1MonitorRepo(bindings.DB);
    checks = new D1CheckRepo(bindings.DB);
    incidents = new D1IncidentRepo(bindings.DB);
    events = new D1IncidentEventRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    const clock = new FixedClock(NOW);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, clock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, clock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, clock)}`,
    };
    executorCalls = [];
    app = buildApp(bindings, {
      clock,
      ids: new FakeIds(),
      uptimeCheckExecutor: async (monitorConfig) => {
        executorCalls.push(structuredClone(monitorConfig));
        return structuredClone(TEST_OUTCOME);
      },
    });
  });

  function headers(actor: Actor): HeadersInit {
    return {
      Authorization: tokens[actor],
      "content-type": "application/json",
    };
  }

  async function create(actor: Actor = "owner") {
    return app.request(`/api/workspaces/${WORKSPACE.id}/uptime-monitors`, {
      method: "POST",
      headers: headers(actor),
      body: JSON.stringify(CONFIG),
    });
  }

  it("rejects GET monitor bodies, unsupported frequency, and member mutation", async () => {
    const getWithBody = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({ ...CONFIG, method: "GET" }),
      },
    );
    expect(getWithBody.status).toBe(400);
    await expect(getWithBody.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "body" }),
        ]),
      },
    });
    const frequency = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({ ...CONFIG, frequencySeconds: 60 }),
      },
    );
    expect(frequency.status).toBe(400);
    const metadataAddress = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          ...CONFIG,
          url: "http://169.254.169.254/",
          method: "GET",
          body: undefined,
        }),
      },
    );
    expect(metadataAddress.status).toBe(400);
    await expect(metadataAddress.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: expect.arrayContaining([
          expect.objectContaining({ field: "url" }),
        ]),
      },
    });
    const member = await create("member");
    expect(member.status).toBe(403);
    expect((await monitors.list(WORKSPACE.id)).length).toBe(0);
  });

  it("creates encrypted config, masks members, updates scheduling, audits, and closes on delete", async () => {
    const created = await create();
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: Record<string, unknown> & { id: string };
    };
    const monitorId = createdBody.data.id;
    expect(createdBody.data).toMatchObject({
      name: CONFIG.name,
      headers: CONFIG.headers,
      body: RAW_BODY,
      headersMasked: false,
      expectedStatus: 201,
      timeoutSeconds: 12,
      notifyOnRecovery: false,
      status: "UNKNOWN",
      checking: false,
      nextCheckAt: new Date(NOW + 300_000).toISOString(),
    });
    const raw = await testEnv()
      .DB.prepare(
        "SELECT encrypted_headers, encrypted_body FROM uptime_monitors WHERE id = ?",
      )
      .bind(monitorId)
      .first<{ encrypted_headers: string; encrypted_body: string }>();
    expect(JSON.stringify(raw)).not.toContain("raw-uptime");

    const memberList = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors`,
      { headers: headers("member") },
    );
    expect(memberList.status).toBe(200);
    await expect(memberList.json()).resolves.toMatchObject({
      data: [
        {
          id: monitorId,
          headers: null,
          body: null,
          headersMasked: true,
        },
      ],
    });
    const adminDetail = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}`,
      { headers: headers("admin") },
    );
    await expect(adminDetail.json()).resolves.toMatchObject({
      data: { headers: CONFIG.headers, body: RAW_BODY, headersMasked: false },
    });

    const updated = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}`,
      {
        method: "PATCH",
        headers: headers("admin"),
        body: JSON.stringify({ frequencySeconds: 600 }),
      },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        frequencySeconds: 600,
        nextCheckAt: new Date(NOW + 600_000).toISOString(),
        expectedStatus: 201,
        timeoutSeconds: 12,
        notifyOnRecovery: false,
        headers: CONFIG.headers,
        body: RAW_BODY,
      },
    });

    const openIncident: Incident = {
      id: "inc_uptime_delete",
      workspaceId: WORKSPACE.id,
      resourceType: "UPTIME_MONITOR",
      browserTestId: null,
      uptimeMonitorId: monitorId,
      status: "OPEN",
      openedAt: NOW - 1_000,
      resolvedAt: null,
      openedByRunId: null,
      resolvedByRunId: null,
      openedByCheckId: "chk_uptime_delete",
      resolvedByCheckId: null,
      lastEventAt: NOW - 1_000,
      createdAt: NOW - 1_000,
    };
    await incidents.insertOpen(openIncident);
    const deleted = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}`,
      { method: "DELETE", headers: headers("admin") },
    );
    expect(deleted.status).toBe(204);
    await expect(monitors.findById(WORKSPACE.id, monitorId)).resolves.toBeNull();
    await expect(
      incidents.findById(WORKSPACE.id, openIncident.id),
    ).resolves.toMatchObject({ status: "RESOLVED", resolvedAt: NOW });
    await expect(events.listForIncident(openIncident.id)).resolves.toMatchObject([
      { type: "MONITOR_DELETED", sourceId: monitorId },
    ]);
    const auditActions = (await audits.list(WORKSPACE.id, null, 10)).map(
      (entry) => entry.action,
    );
    expect(auditActions).toEqual(
      expect.arrayContaining([
        "monitor.created",
        "monitor.updated",
        "monitor.deleted",
      ]),
    );
  });

  it("runs test-request inline with condition detail and persists nothing", async () => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/test-request`,
      {
        method: "POST",
        headers: headers("admin"),
        body: JSON.stringify({
          url: "https://example.com/health",
          method: "GET",
          expectedStatus: 204,
          frequencySeconds: 300,
          timeoutSeconds: 10,
          maxRetries: 0,
          notifyOnRecovery: true,
          channelIds: [],
        }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { ...TEST_OUTCOME, passed: true },
    });
    expect(executorCalls).toMatchObject([
      { name: "Test request", method: "GET", expectedStatus: 204 },
    ]);
    expect(await monitors.list(WORKSPACE.id)).toEqual([]);
    expect(await checks.listForMonitor("mon_any", null, 10)).toEqual([]);
    const counts = await testEnv()
      .DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM uptime_monitors) AS monitors,
           (SELECT COUNT(*) FROM uptime_checks) AS checks`,
      )
      .first<{ monitors: number; checks: number }>();
    expect(counts).toEqual({ monitors: 0, checks: 0 });
  });

  it("keeps one-off test requests read-only because they have no durable cycle key", async () => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/test-request`,
      {
        method: "POST",
        headers: headers("admin"),
        body: JSON.stringify({
          url: "https://example.com/mutate",
          method: "DELETE",
          expectedStatus: 204,
          frequencySeconds: 300,
          timeoutSeconds: 10,
          maxRetries: 0,
          notifyOnRecovery: true,
          channelIds: [],
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: [
          { field: "method", message: "Test requests only allow GET or HEAD" },
        ],
      },
    });
    expect(executorCalls).toEqual([]);
  });

  it("rate limits monitor creation and test requests independently", async () => {
    for (let count = 0; count < RATE_LIMITS.monitor_create.limit; count += 1) {
      const response = await app.request(
        `/api/workspaces/${WORKSPACE.id}/uptime-monitors`,
        {
          method: "POST",
          headers: headers("owner"),
          body: JSON.stringify({ ...CONFIG, name: `Monitor ${count}` }),
        },
      );
      expect(response.status).toBe(201);
    }
    const limitedCreate = await create();
    expect(limitedCreate.status).toBe(429);
    expect(limitedCreate.headers.get("Retry-After")).toMatch(/^\d+$/u);

    const request = {
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: 204,
      frequencySeconds: 300,
      timeoutSeconds: 10,
      maxRetries: 0,
      notifyOnRecovery: true,
      channelIds: [],
    };
    for (let count = 0; count < RATE_LIMITS.test_request.limit; count += 1) {
      const response = await app.request(
        `/api/workspaces/${WORKSPACE.id}/uptime-monitors/test-request`,
        {
          method: "POST",
          headers: headers("admin"),
          body: JSON.stringify(request),
        },
      );
      expect(response.status).toBe(200);
    }
    const limitedTest = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/test-request`,
      {
        method: "POST",
        headers: headers("admin"),
        body: JSON.stringify(request),
      },
    );
    expect(limitedTest.status).toBe(429);
    expect(limitedTest.headers.get("Retry-After")).toMatch(/^\d+$/u);
    expect(executorCalls).toHaveLength(RATE_LIMITS.test_request.limit);
  });

  it("lists member-visible check history with a keyset cursor and returns stats", async () => {
    const created = await create();
    const monitorId = ((await created.json()) as { data: { id: string } }).data.id;
    const values: UptimeCheck[] = [300, 200, 100].map((responseTimeMs, index) => ({
      id: `chk_routes_${index}`,
      workspaceId: WORKSPACE.id,
      uptimeMonitorId: monitorId,
      cycleId: `cyc_routes_${index}`,
      attemptIndex: 0,
      status: "PASSED",
      httpStatus: 200,
      responseTimeMs,
      failureReason: null,
      responseExcerpt: `private excerpt ${index}`,
      checkedAt: NOW - (index + 1) * 1_000,
      createdAt: NOW - (index + 1) * 1_000,
    }));
    for (const value of values) await checks.insertIfAbsent(value);

    const first = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}/checks?limit=2`,
      { headers: headers("member") },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: { id: string; checkedAt: string }[];
      nextCursor: string | null;
    };
    expect(firstBody.data).toEqual([
      expect.objectContaining({
        id: "chk_routes_0",
        checkedAt: new Date(NOW - 1_000).toISOString(),
      }),
      expect.objectContaining({ id: "chk_routes_1" }),
    ]);
    expect(firstBody.data[0]).not.toHaveProperty("responseExcerpt");
    expect(firstBody.nextCursor).not.toBeNull();
    const second = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}/checks?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor as string)}`,
      { headers: headers("member") },
    );
    await expect(second.json()).resolves.toMatchObject({
      data: [{ id: "chk_routes_2" }],
      nextCursor: null,
    });

    const stats = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}/stats`,
      { headers: headers("member") },
    );
    expect(stats.status).toBe(200);
    await expect(stats.json()).resolves.toEqual({
      data: {
        uptime24h: 100,
        uptime7d: 100,
        uptime30d: 100,
        avgResponseTimeMs24h: 200,
        series: [
          {
            t: new Date(NOW - 3_000).toISOString(),
            responseTimeMs: 100,
            status: "PASSED",
          },
          {
            t: new Date(NOW - 2_000).toISOString(),
            responseTimeMs: 200,
            status: "PASSED",
          },
          {
            t: new Date(NOW - 1_000).toISOString(),
            responseTimeMs: 300,
            status: "PASSED",
          },
        ],
      },
    });
  });
});
