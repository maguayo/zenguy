import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type {
  RunArtifact,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { NotificationDelivery } from "../../domain/channels/types";
import type { Incident, IncidentEvent } from "../../domain/incidents/types";
import type { UptimeCheck } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ArtifactRepo } from "../../infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1CheckRepo } from "../../infrastructure/db/check_repo";
import { D1DeliveryRepo } from "../../infrastructure/db/delivery_repo";
import { D1IncidentEventRepo } from "../../infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock, systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { FakeIds } from "../../test/fakes/ids";
import { RecordingPaddleClient } from "../../test/fakes/billing";
import { freshDb, stripeTestEnv } from "../../test/helpers";

const NOW = Date.parse("2026-08-19T11:00:00.000Z");
const RAW_SECRET = "raw-saved-secret-value";
const RAW_CHANNEL_URL =
  "https://hooks.slack.com/services/T000/B000/raw-channel-secret";
const RAW_MONITOR_HEADER = "Bearer raw-monitor-header-value";
const RAW_MONITOR_BODY = '{"credential":"raw-monitor-body-value"}';
const SENSITIVE_VALUES = [
  RAW_SECRET,
  RAW_CHANNEL_URL,
  RAW_MONITOR_HEADER,
  RAW_MONITOR_BODY,
];
const OWNER: User = {
  id: "usr_leak_owner",
  name: "Leak Owner",
  email: "owner@leak.test",
  passwordHash: "unused",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const MEMBER: User = {
  ...OWNER,
  id: "usr_leak_member",
  name: "Leak Member",
  email: "member@leak.test",
};
const WORKSPACE: Workspace = {
  id: "ws_secret_leak",
  name: "Secret Leak Workspace",
  slug: "secret-leak-workspace",
  timezone: "UTC",
  ownerUserId: OWNER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_secret_leak",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_secret_leak",
  providerSubscriptionId: "provider_sub_secret_leak",
  status: "ACTIVE",
  periodStart: NOW - 86_400_000,
  periodEnd: NOW + 30 * 86_400_000,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: "https://billing.example.test/update",
  cancelUrl: "https://billing.example.test/cancel",
  createdAt: NOW,
  updatedAt: NOW,
};

describe("workspace read endpoint secret-leak sweep", () => {
  it("never exposes saved/channel/monitor secrets to a member or in privileged metadata reads", async () => {
    await freshDb();
    const bindings = stripeTestEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    await users.insert(OWNER);
    await users.insert(MEMBER);
    await new D1WorkspaceRepo(bindings.DB).insert(WORKSPACE);
    const members = new D1MemberRepo(bindings.DB);
    await members.insert({
      id: "mem_leak_owner",
      workspaceId: WORKSPACE.id,
      userId: OWNER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await members.insert({
      id: "mem_leak_member",
      workspaceId: WORKSPACE.id,
      userId: MEMBER.id,
      role: "MEMBER",
      invitedBy: OWNER.id,
      joinedAt: NOW,
    });
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    const paddle = new RecordingPaddleClient();
    paddle.transactions = [
      {
        id: "txn_secret_leak",
        billedAt: "2026-08-19T10:00:00.000Z",
        status: "paid",
        totalCents: 3_900,
        currency: "EUR",
        invoiceNumber: "INV-LEAK",
      },
    ];
    paddle.invoiceUrl = "https://billing.example.test/invoice.pdf";
    const clock = new FixedClock(NOW);
    const app = buildApp(bindings, {
      clock,
      ids: new FakeIds(),
      paddleClient: paddle,
      runQueue: {
        send: async () => ({
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        }),
      },
    });
    const ownerToken = await issueAccessToken(config, OWNER, systemClock);
    const memberToken = await issueAccessToken(config, MEMBER, systemClock);
    const headers = (actor: "owner" | "member"): HeadersInit => ({
      Authorization: `Bearer ${actor === "owner" ? ownerToken : memberToken}`,
      "content-type": "application/json",
    });

    const secretResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          key: "LEAK_TOKEN",
          value: RAW_SECRET,
          allowedDomains: ["example.com"],
          description: "Read sweep secret",
        }),
      },
    );
    expect(secretResponse.status).toBe(201);

    const channelResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          name: "Leak Slack",
          type: "SLACK",
          config: { webhookUrl: RAW_CHANNEL_URL },
        }),
      },
    );
    expect(channelResponse.status).toBe(201);
    const channelId = (
      (await channelResponse.json()) as { data: { id: string } }
    ).data.id;

    const monitorResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/uptime-monitors`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          name: "Leak monitor",
          url: "https://example.com/health",
          method: "POST",
          headers: [
            { key: "Authorization", value: RAW_MONITOR_HEADER },
          ],
          body: RAW_MONITOR_BODY,
          expectedStatus: 200,
          frequencySeconds: 300,
          timeoutSeconds: 10,
          maxRetries: 0,
          notifyOnRecovery: true,
          channelIds: [channelId],
        }),
      },
    );
    expect(monitorResponse.status).toBe(201);
    const monitorId = (
      (await monitorResponse.json()) as { data: { id: string } }
    ).data.id;

    const browserResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          name: "Leak browser test",
          startUrl: "https://example.com",
          instructions: "Authenticate with {{LEAK_TOKEN}} and check the page",
          device: "DESKTOP",
          intervalHours: 24,
          maxRetries: 0,
          notifyOnRecovery: true,
          channelIds: [channelId],
        }),
      },
    );
    expect(browserResponse.status).toBe(201);
    const browserTestId = (
      (await browserResponse.json()) as { data: { id: string } }
    ).data.id;

    const incidentId = "inc_secret_leak";
    const run: TestRun = {
      id: "run_secret_leak",
      workspaceId: WORKSPACE.id,
      browserTestId,
      source: "MANUAL",
      status: "FAILED",
      snapshot: {
        name: "Leak browser test",
        startUrl: "https://example.com",
        instructions: "Authenticate with {{LEAK_TOKEN}} and check the page",
        device: "DESKTOP",
        intervalHours: 24,
        maxRetries: 0,
        notifyOnRecovery: true,
        channelIds: [channelId],
        viewport: { width: 1440, height: 900 },
        modelName: "gpt-5-mini",
        runnerVersion: "leak-sweep",
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
      triggeredByUserId: OWNER.id,
      incidentId,
      createdAt: NOW - 2_000,
    };
    await new D1RunRepo(bindings.DB).insert(run);
    const attempt: TestAttempt = {
      id: "att_secret_leak",
      testRunId: run.id,
      attemptIndex: 0,
      status: "FAILED",
      retryDelaySeconds: 0,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      summary: `The value ${RAW_SECRET} was rejected`,
      expectedResult: `Accept ${RAW_SECRET}`,
      actualResult: `Rejected ${RAW_SECRET}`,
      failureReason: `Credential ${RAW_SECRET} failed`,
      visitedUrlsJson: JSON.stringify([
        `https://example.com/?token=${encodeURIComponent(RAW_SECRET)}`,
      ]),
      consoleErrorsJson: JSON.stringify([
        { level: "error", message: RAW_SECRET, url: null, timestamp: "now" },
      ]),
      networkErrorsJson: "[]",
      tokenUsage: 20,
      inputTokens: null,
      outputTokens: null,
      modelName: "gpt-5-mini",
      runnerVersion: "leak-sweep",
      runnerKind: null,
      systemErrorCode: null,
      createdAt: run.createdAt,
    };
    await new D1AttemptRepo(bindings.DB).insert(attempt);
    const report: RunArtifact = {
      id: "art_secret_leak_report",
      workspaceId: WORKSPACE.id,
      runId: run.id,
      attemptId: attempt.id,
      type: "MARKDOWN_REPORT",
      storageKey: "ws/ws_secret_leak/leak-report.md",
      mimeType: "text/markdown",
      sizeBytes: 32,
      metadataJson: JSON.stringify({ filename: "leak-report.md" }),
      createdAt: NOW,
      expiresAt: NOW + 86_400_000,
    };
    await new D1ArtifactRepo(bindings.DB).insert(report);
    await bindings.ARTIFACTS.put(
      report.storageKey,
      "# Report\n\nCredential: {{LEAK_TOKEN}}\n",
      { httpMetadata: { contentType: report.mimeType } },
    );
    const incident: Incident = {
      id: incidentId,
      workspaceId: WORKSPACE.id,
      resourceType: "BROWSER_TEST",
      browserTestId,
      uptimeMonitorId: null,
      status: "OPEN",
      openedAt: NOW,
      resolvedAt: null,
      openedByRunId: run.id,
      resolvedByRunId: null,
      openedByCheckId: null,
      resolvedByCheckId: null,
      lastEventAt: NOW,
      createdAt: NOW,
    };
    await new D1IncidentRepo(bindings.DB).insertOpen(incident);
    const incidentEvent: IncidentEvent = {
      id: "evt_secret_leak",
      incidentId,
      type: "OPENED",
      sourceId: run.id,
      message: "Credential {{LEAK_TOKEN}} failed",
      metadataJson: JSON.stringify({ token: "***" }),
      createdAt: NOW,
    };
    await new D1IncidentEventRepo(bindings.DB).insert(incidentEvent);
    const delivery: NotificationDelivery = {
      id: "del_secret_leak",
      workspaceId: WORKSPACE.id,
      incidentId,
      notificationChannelId: channelId,
      eventType: "FAILURE",
      status: "FAILED",
      providerMessageId: null,
      attemptCount: 3,
      errorSanitized: "Provider rejected {{LEAK_TOKEN}}",
      sentAt: null,
      createdAt: NOW,
    };
    await new D1DeliveryRepo(bindings.DB).insert(delivery);
    const check: UptimeCheck = {
      id: "chk_secret_leak",
      workspaceId: WORKSPACE.id,
      uptimeMonitorId: monitorId,
      cycleId: "cyc_secret_leak",
      attemptIndex: 0,
      status: "FAILED",
      httpStatus: 500,
      responseTimeMs: 50,
      failureReason: "BODY_MISMATCH",
      responseExcerpt: "Observed {{LEAK_TOKEN}}",
      checkedAt: NOW,
      createdAt: NOW,
    };
    await new D1CheckRepo(bindings.DB).insertIfAbsent(check);

    const reads: Array<{
      label: string;
      path: string;
      actor: "owner" | "member";
    }> = [
      { label: "me", path: "/api/auth/me", actor: "member" },
      { label: "billing config", path: "/api/billing/config", actor: "owner" },
      { label: "workspace list", path: "/api/workspaces", actor: "member" },
      { label: "workspace", path: `/api/workspaces/${WORKSPACE.id}`, actor: "member" },
      { label: "members", path: `/api/workspaces/${WORKSPACE.id}/members`, actor: "member" },
      { label: "invitations", path: `/api/workspaces/${WORKSPACE.id}/invitations`, actor: "owner" },
      { label: "billing", path: `/api/workspaces/${WORKSPACE.id}/billing`, actor: "owner" },
      { label: "invoice", path: `/api/workspaces/${WORKSPACE.id}/billing/invoices/txn_secret_leak/url`, actor: "owner" },
      { label: "secrets", path: `/api/workspaces/${WORKSPACE.id}/secrets`, actor: "member" },
      { label: "channels", path: `/api/workspaces/${WORKSPACE.id}/channels`, actor: "member" },
      { label: "deliveries", path: `/api/workspaces/${WORKSPACE.id}/channels/${channelId}/deliveries`, actor: "member" },
      { label: "tests", path: `/api/workspaces/${WORKSPACE.id}/browser-tests`, actor: "member" },
      { label: "test", path: `/api/workspaces/${WORKSPACE.id}/browser-tests/${browserTestId}`, actor: "member" },
      { label: "runs", path: `/api/workspaces/${WORKSPACE.id}/browser-tests/${browserTestId}/runs`, actor: "member" },
      { label: "run", path: `/api/workspaces/${WORKSPACE.id}/runs/${run.id}`, actor: "member" },
      { label: "attempt", path: `/api/workspaces/${WORKSPACE.id}/attempts/${attempt.id}`, actor: "member" },
      { label: "report", path: `/api/workspaces/${WORKSPACE.id}/runs/${run.id}/report`, actor: "member" },
      { label: "monitors", path: `/api/workspaces/${WORKSPACE.id}/uptime-monitors`, actor: "member" },
      { label: "monitor", path: `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}`, actor: "member" },
      { label: "checks", path: `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}/checks`, actor: "member" },
      { label: "stats", path: `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${monitorId}/stats`, actor: "member" },
      { label: "incidents", path: `/api/workspaces/${WORKSPACE.id}/incidents`, actor: "member" },
      { label: "incident", path: `/api/workspaces/${WORKSPACE.id}/incidents/${incidentId}`, actor: "member" },
      { label: "overview", path: `/api/workspaces/${WORKSPACE.id}/overview`, actor: "member" },
      { label: "audit", path: `/api/workspaces/${WORKSPACE.id}/audit-logs`, actor: "owner" },
    ];
    const responseBodies: string[] = [];
    for (const read of reads) {
      const response = await app.request(read.path, {
        headers: headers(read.actor),
      });
      expect(response.status, read.label).toBe(200);
      const text = await response.text();
      responseBodies.push(text);
      for (const sensitive of SENSITIVE_VALUES) {
        expect(text, `${read.label} leaked ${sensitive}`).not.toContain(
          sensitive,
        );
      }
    }
    const serialized = responseBodies.join("\n");
    expect(serialized).toContain("{{LEAK_TOKEN}}");
    expect(serialized).toContain('"headersMasked":true');
  });
});
