import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type {
  BrowserTest,
  RunArtifact,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { Incident } from "../../domain/incidents/types";
import type { WorkspaceSecret } from "../../domain/secrets/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ActivityEventRepo } from "../../infrastructure/db/activity_event_repo";
import { D1ArtifactRepo } from "../../infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1IncidentUpdateRepo } from "../../infrastructure/db/incident_update_repo";
import {
  D1StatusPageItemRepo,
  D1StatusPageRepo,
} from "../../infrastructure/db/status_page_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SecretRepo } from "../../infrastructure/db/secret_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock, systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { encryptSecret, hmacSign } from "../../shared/crypto";
import { freshDb, testEnv } from "../../test/helpers";

const NOW = Date.parse("2026-08-19T10:00:00.000Z");
const USER_A: User = {
  id: "usr_tenant_a",
  name: "Tenant A Owner",
  email: "a@cross-tenant.test",
  passwordHash: "unused",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const USER_B: User = {
  ...USER_A,
  id: "usr_tenant_b",
  name: "Tenant B Owner",
  email: "b@cross-tenant.test",
};
const WORKSPACE_A: Workspace = {
  id: "ws_tenant_a",
  name: "Tenant A",
  slug: "tenant-a",
  timezone: "UTC",
  ownerUserId: USER_A.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const WORKSPACE_B: Workspace = {
  ...WORKSPACE_A,
  id: "ws_tenant_b",
  name: "Tenant B",
  slug: "tenant-b",
  ownerUserId: USER_B.id,
};

function subscription(workspaceId: string): Subscription {
  return {
    id: `sub_${workspaceId}`,
    workspaceId,
    provider: "paddle",
    providerCustomerId: `ctm_${workspaceId}`,
    providerSubscriptionId: `provider_${workspaceId}`,
    status: "ACTIVE",
    periodStart: NOW - 1_000,
    periodEnd: NOW + 30 * 86_400_000,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("cross-tenant route isolation", () => {
  it("returns 404 when a workspace B participant presents workspace A resource ids", async () => {
    await freshDb();
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    await users.insert(USER_A);
    await users.insert(USER_B);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    await workspaces.insert(WORKSPACE_A);
    await workspaces.insert(WORKSPACE_B);
    const members = new D1MemberRepo(bindings.DB);
    await members.insert({
      id: "mem_tenant_a",
      workspaceId: WORKSPACE_A.id,
      userId: USER_A.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await members.insert({
      id: "mem_tenant_b",
      workspaceId: WORKSPACE_B.id,
      userId: USER_B.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    const subscriptions = new D1SubscriptionRepo(bindings.DB);
    await subscriptions.upsertByWorkspace(subscription(WORKSPACE_A.id));
    await subscriptions.upsertByWorkspace(subscription(WORKSPACE_B.id));

    const browserTest: BrowserTest = {
      id: "bt_tenant_a",
      workspaceId: WORKSPACE_A.id,
      name: "Tenant A test",
      startUrl: "https://example.com",
      instructions: "Check the page",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 0,
      notifyOnRecovery: true,
      nextRunAt: NOW + 86_400_000,
      createdBy: USER_A.id,
      updatedBy: USER_A.id,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
    await new D1BrowserTestRepo(bindings.DB).insert(browserTest);
    const run: TestRun = {
      id: "run_tenant_a",
      workspaceId: WORKSPACE_A.id,
      browserTestId: browserTest.id,
      source: "MANUAL",
      status: "FAILED",
      snapshot: {
        name: browserTest.name,
        startUrl: browserTest.startUrl,
        instructions: browserTest.instructions,
        device: "DESKTOP",
        intervalHours: 24,
        maxRetries: 0,
        notifyOnRecovery: true,
        channelIds: [],
        viewport: { width: 1440, height: 900 },
        modelName: "gpt-5-mini",
        runnerVersion: "cross-tenant-test",
      },
      scheduledFor: null,
      queuedAt: NOW - 2_000,
      startedAt: NOW - 1_000,
      finishedAt: NOW,
      durationMs: 1_000,
      attemptCount: 1,
      infraAttempts: 0,
      passedAfterRetry: false,
      billable: true,
      usageEventId: null,
      triggeredByUserId: USER_A.id,
      incidentId: null,
      createdAt: NOW - 2_000,
    };
    await new D1RunRepo(bindings.DB).insert(run);
    const attempt: TestAttempt = {
      id: "att_tenant_a",
      testRunId: run.id,
      attemptIndex: 0,
      status: "FAILED",
      retryDelaySeconds: 0,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      summary: "Failed",
      expectedResult: "Pass",
      actualResult: "Fail",
      failureReason: "Element missing",
      visitedUrlsJson: "[]",
      consoleErrorsJson: "[]",
      networkErrorsJson: "[]",
      tokenUsage: 10,
      inputTokens: null,
      outputTokens: null,
      modelName: "gpt-5-mini",
      runnerVersion: "cross-tenant-test",
      runnerKind: null,
      systemErrorCode: null,
      createdAt: run.createdAt,
    };
    await new D1AttemptRepo(bindings.DB).insert(attempt);
    const artifact: RunArtifact = {
      id: "art_tenant_a",
      workspaceId: WORKSPACE_A.id,
      runId: run.id,
      attemptId: attempt.id,
      type: "SCREENSHOT",
      storageKey: "ws/ws_tenant_a/cross-tenant.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      metadataJson: null,
      createdAt: NOW,
      expiresAt: NOW + 86_400_000,
    };
    await new D1ArtifactRepo(bindings.DB).insert(artifact);
    const monitor: UptimeMonitor = {
      id: "mon_tenant_a",
      workspaceId: WORKSPACE_A.id,
      name: "Tenant A monitor",
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
      nextCheckAt: NOW + 300_000,
      currentStatus: "DOWN",
      currentCycleId: null,
      cycleStartedAt: null,
      lastCheckAt: NOW,
      lastResponseTimeMs: 100,
      createdBy: USER_A.id,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
    await new D1MonitorRepo(bindings.DB).insert(monitor);
    const incident: Incident = {
      id: "inc_tenant_a",
      workspaceId: WORKSPACE_A.id,
      resourceType: "UPTIME_MONITOR",
      browserTestId: null,
      uptimeMonitorId: monitor.id,
      status: "OPEN",
      openedAt: NOW,
      resolvedAt: null,
      openedByRunId: null,
      resolvedByRunId: null,
      openedByCheckId: "chk_tenant_a",
      resolvedByCheckId: null,
      lastEventAt: NOW,
      createdAt: NOW,
    };
    await new D1IncidentRepo(bindings.DB).insertOpen(incident);
    const statusPage = {
      id: "sp_tenant_a",
      workspaceId: WORKSPACE_A.id,
      slug: "tenant-a-status",
      title: "Tenant A Status",
      description: null,
      accentColor: null,
      theme: "SYSTEM" as const,
      publishedAt: null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
    await new D1StatusPageRepo(bindings.DB).insert(statusPage);
    const statusPageItem = {
      id: "spi_tenant_a",
      statusPageId: statusPage.id,
      workspaceId: WORKSPACE_A.id,
      resourceType: "UPTIME_MONITOR" as const,
      browserTestId: null,
      uptimeMonitorId: monitor.id,
      displayName: "Tenant A API",
      groupName: null,
      position: 0,
      createdAt: NOW,
    };
    await new D1StatusPageItemRepo(bindings.DB).insert(statusPageItem);
    const incidentUpdate = {
      id: "iu_tenant_a",
      incidentId: incident.id,
      workspaceId: WORKSPACE_A.id,
      message: "Tenant A update",
      createdBy: null,
      createdAt: NOW,
    };
    await new D1IncidentUpdateRepo(bindings.DB).insert(incidentUpdate);
    const secret: WorkspaceSecret = {
      id: "sec_tenant_a",
      workspaceId: WORKSPACE_A.id,
      key: "TENANT_A_TOKEN",
      encryptedValue: await encryptSecret(
        "tenant-a-secret",
        config.encryptionKeys,
        {
          type: "workspace_secret",
          workspaceId: WORKSPACE_A.id,
          recordId: "sec_tenant_a",
        },
      ),
      encryptionVersion: 4,
      allowedDomains: ["example.com"],
      description: null,
      createdBy: USER_A.id,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await new D1SecretRepo(bindings.DB).insert(secret);

    const token = await issueAccessToken(config, USER_B, systemClock);
    const authorization = `Bearer ${token}`;
    const exp = Math.floor(NOW / 1_000) + 600;
    const sseSig = await hmacSign(
      config.artifactUrlSecret,
      `sse.${run.id}.${exp}`,
    );
    const app = buildApp(bindings, { clock: new FixedClock(NOW) });
    const probes: Array<{ label: string; path: string; init?: RequestInit }> = [
      {
        label: "browser test",
        path: `/api/workspaces/${WORKSPACE_B.id}/browser-tests/${browserTest.id}`,
      },
      {
        label: "run",
        path: `/api/workspaces/${WORKSPACE_B.id}/runs/${run.id}`,
      },
      {
        label: "report",
        path: `/api/workspaces/${WORKSPACE_B.id}/runs/${run.id}/report`,
      },
      {
        label: "attempt and its artifact signature",
        path: `/api/workspaces/${WORKSPACE_B.id}/attempts/${attempt.id}`,
      },
      {
        label: "SSE signature with the wrong workspace",
        path: `/api/workspaces/${WORKSPACE_B.id}/runs/${run.id}/events?exp=${exp}&sig=${encodeURIComponent(sseSig)}`,
      },
      {
        label: "guessed artifact id without its capability signature",
        path: `/api/artifact-content?id=${artifact.id}&exp=${exp}&sig=guessed`,
        init: { headers: { Authorization: authorization } },
      },
      {
        label: "monitor",
        path: `/api/workspaces/${WORKSPACE_B.id}/uptime-monitors/${monitor.id}`,
      },
      {
        label: "monitor checks",
        path: `/api/workspaces/${WORKSPACE_B.id}/uptime-monitors/${monitor.id}/checks`,
      },
      {
        label: "monitor stats",
        path: `/api/workspaces/${WORKSPACE_B.id}/uptime-monitors/${monitor.id}/stats`,
      },
      {
        label: "incident",
        path: `/api/workspaces/${WORKSPACE_B.id}/incidents/${incident.id}`,
      },
      {
        label: "status page",
        path: `/api/workspaces/${WORKSPACE_B.id}/status-pages/${statusPage.id}`,
      },
      {
        label: "status page preview",
        path: `/api/workspaces/${WORKSPACE_B.id}/status-pages/${statusPage.id}/preview`,
      },
      {
        label: "status page mutation",
        path: `/api/workspaces/${WORKSPACE_B.id}/status-pages/${statusPage.id}`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Hijacked" }),
        },
      },
      {
        label: "status page item added against a foreign monitor",
        path: `/api/workspaces/${WORKSPACE_B.id}/status-pages/${statusPage.id}/items`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            resourceType: "UPTIME_MONITOR",
            resourceId: monitor.id,
            displayName: "Stolen",
          }),
        },
      },
      {
        label: "incident updates listing",
        path: `/api/workspaces/${WORKSPACE_B.id}/incidents/${incident.id}/updates`,
      },
      {
        label: "incident update posted cross-tenant",
        path: `/api/workspaces/${WORKSPACE_B.id}/incidents/${incident.id}/updates`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Hijacked update" }),
        },
      },
      {
        label: "incident update deleted cross-tenant",
        path: `/api/workspaces/${WORKSPACE_B.id}/incidents/${incident.id}/updates/${incidentUpdate.id}`,
        init: { method: "DELETE" },
      },
      {
        label: "secret mutation lookup",
        path: `/api/workspaces/${WORKSPACE_B.id}/secrets/${secret.id}`,
        init: {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "cross-tenant probe" }),
        },
      },
    ];

    for (const probe of probes) {
      const response = await app.request(probe.path, {
        ...probe.init,
        headers: {
          Authorization: authorization,
          ...probe.init?.headers,
        },
      });
      expect(response.status, probe.label).toBe(404);
      await expect(response.json(), probe.label).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
    }
  });

  it("drops client activity reported against another tenant's workspace", async () => {
    await freshDb();
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    await users.insert(USER_A);
    await users.insert(USER_B);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    await workspaces.insert(WORKSPACE_A);
    await workspaces.insert(WORKSPACE_B);
    const members = new D1MemberRepo(bindings.DB);
    await members.insert({
      id: "mem_tenant_a",
      workspaceId: WORKSPACE_A.id,
      userId: USER_A.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await members.insert({
      id: "mem_tenant_b",
      workspaceId: WORKSPACE_B.id,
      userId: USER_B.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    const token = await issueAccessToken(config, USER_A, systemClock);
    const app = buildApp(bindings, { clock: new FixedClock(NOW) });

    // Indistinguishable from a workspace that does not exist: 202 and a
    // silent drop, never a 403/404 that would confirm the id.
    const response = await app.request("/api/me/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        events: [{ type: "web.page_viewed", workspaceId: WORKSPACE_B.id }],
      }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      data: { accepted: 0, dropped: 1 },
    });
    const stored = await new D1ActivityEventRepo(bindings.DB).listRecent(10);
    expect(stored.filter((event) => event.workspaceId === WORKSPACE_B.id)).toEqual([]);
    expect(stored).toEqual([]);
  });
});
