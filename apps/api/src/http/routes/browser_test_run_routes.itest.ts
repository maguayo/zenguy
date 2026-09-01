import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import { verifyIrreversibleRunAuthorization } from "../../domain/browser_tests/irreversible_authorization";
import type { AttemptMessage } from "../../domain/queues";
import {
  REMOTE_AI_CONSENT_VERSION,
  REMOTE_AI_PROVIDER,
} from "../../domain/users/remote_ai_consent";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1RemoteAiConsentRepo } from "../../infrastructure/db/remote_ai_consent_repo";
import { D1StepRepo } from "../../infrastructure/db/step_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { D1DurableWorkflowRepo } from "../../infrastructure/db/durable_workflow_repo";
import { PublishQueueOutbox } from "../../application/durability/publish_outbox";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { FALLBACK_CLAIM_MIN_AGE_MS } from "../../shared/constants";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const NOW = Date.now();
const OWNER: User = {
  id: "usr_run_owner",
  name: "Owner",
  email: "owner@runs.test",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const MEMBER: User = {
  ...OWNER,
  id: "usr_run_member",
  name: "Member",
  email: "member@runs.test",
};
const WORKSPACE: Workspace = {
  id: "ws_runs",
  name: "Runs Workspace",
  slug: "runs-workspace",
  timezone: "UTC",
  ownerUserId: OWNER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_runs",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_runs",
  providerSubscriptionId: "sub_provider_runs",
  status: "ACTIVE",
  periodStart: 1,
  periodEnd: 9_999_999_999_999,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: 1,
  updatedAt: 1,
};
const TEST: BrowserTest = {
  id: "bt_run",
  workspaceId: WORKSPACE.id,
  name: "Checkout",
  startUrl: "https://shop.example.com/checkout",
  instructions: "Verify checkout",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 2,
  notifyOnRecovery: true,
  nextRunAt: NOW + 6 * 3_600_000,
  createdBy: OWNER.id,
  updatedBy: OWNER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const DRAFT = {
  name: "Draft checkout",
  startUrl: "https://shop.example.com/draft",
  instructions: "Validate the draft",
  device: "MOBILE",
  intervalHours: 3,
  maxRetries: 1,
  notifyOnRecovery: false,
  channelIds: [],
} as const;

class RecordingRunQueue implements Pick<Queue<AttemptMessage>, "send"> {
  readonly messages: AttemptMessage[] = [];
  failures = 0;

  async send(
    message: AttemptMessage,
    _options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("queue unavailable");
    }
    this.messages.push(structuredClone(message));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

describe("browser test run creation routes", () => {
  let app: Hono<AppEnv>;
  let queue: RecordingRunQueue;
  let runs: D1RunRepo;
  let attempts: D1AttemptRepo;
  let subscriptions: D1SubscriptionRepo;
  let ownerToken: string;
  let memberToken: string;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    await users.insert(OWNER);
    await users.insert(MEMBER);
    await workspaces.insert(WORKSPACE);
    await members.insert({
      id: "mem_run_owner",
      workspaceId: WORKSPACE.id,
      userId: OWNER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: 1,
    });
    await members.insert({
      id: "mem_run_member",
      workspaceId: WORKSPACE.id,
      userId: MEMBER.id,
      role: "MEMBER",
      invitedBy: OWNER.id,
      joinedAt: 2,
    });
    subscriptions = new D1SubscriptionRepo(bindings.DB);
    await subscriptions.upsertByWorkspace(SUBSCRIPTION);
    const tests = new D1BrowserTestRepo(bindings.DB);
    await tests.insert(TEST);
    await tests.setChannels(TEST.id, ["ch_email"]);
    runs = new D1RunRepo(bindings.DB);
    attempts = new D1AttemptRepo(bindings.DB);
    queue = new RecordingRunQueue();
    const clock = new FixedClock(NOW);
    ownerToken = `Bearer ${await issueAccessToken(config, OWNER, clock)}`;
    memberToken = `Bearer ${await issueAccessToken(config, MEMBER, clock)}`;
    app = buildApp(bindings, {
      clock,
      ids: new FakeIds(),
      runQueue: queue,
    });
  });

  function headers(token: string): HeadersInit {
    return { Authorization: token, "content-type": "application/json" };
  }

  it("atomically creates a manual run and attempt, queues it, and rejects a second active run", async () => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
      { method: "POST", headers: headers(ownerToken) },
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { data: { runId: string } };
    const run = await runs.findById(WORKSPACE.id, body.data.runId);
    expect(run).toMatchObject({
      browserTestId: TEST.id,
      source: "MANUAL",
      status: "QUEUED",
      triggeredByUserId: OWNER.id,
      billable: true,
      snapshot: {
        name: TEST.name,
        channelIds: ["ch_email"],
        viewport: { width: 1440, height: 900 },
        modelName: "gpt-5-mini",
        runnerVersion: "zenguy-local-runner/1.0.0",
      },
    });
    const initialAttempts = await attempts.listForRun(body.data.runId);
    expect(initialAttempts).toEqual([
      expect.objectContaining({
        testRunId: body.data.runId,
        attemptIndex: 0,
        status: "QUEUED",
        retryDelaySeconds: 0,
      }),
    ]);
    expect(queue.messages).toEqual([
      {
        kind: "attempt",
        runId: body.data.runId,
        attemptId: initialAttempts[0]?.id,
        attemptIndex: 0,
        executionGeneration: initialAttempts[0]?.queuedAt,
      },
    ]);

    const duplicate = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
      { method: "POST", headers: headers(ownerToken) },
    );
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({
      error: {
        code: "ACTIVE_RUN_EXISTS",
        message: "A run is already in progress for this test",
      },
    });
    expect(queue.messages).toHaveLength(1);
    const audit = await new D1AuditRepo(testEnv().DB).list(
      WORKSPACE.id,
      null,
      10,
    );
    expect(audit[0]).toMatchObject({
      action: "test.run_manual",
      resourceId: TEST.id,
    });
  });

  it("lets the external runner claim, start, stream a step, and complete the queued attempt", async () => {
    const created = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
      { method: "POST", headers: headers(ownerToken) },
    );
    const createdBody = (await created.json()) as { data: { runId: string } };
    const message = queue.messages[0];
    expect(message).toBeDefined();
    if (message === undefined) throw new Error("Run message missing");
    const workerId = "primary-mac-1";
    const runnerHeaders = headers(
      `Bearer ${"runner-test-secret".padEnd(32, "-")}`,
    );

    const claimed = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ deliveryId: "cf-message-1", message, workerId }),
    });
    expect(claimed.status).toBe(200);
    const claimBody = (await claimed.json()) as {
      data: {
        disposition: "EXECUTE";
        job: {
          capability: string;
          reference: Record<string, unknown>;
          snapshot: { startUrl: string };
        };
      };
    };
    expect(claimBody.data).toMatchObject({
      disposition: "EXECUTE",
      job: {
        snapshot: { startUrl: TEST.startUrl },
      },
    });
    const reference = claimBody.data.job.reference;
    const jobHeaders = {
      ...headers(`Bearer ${claimBody.data.job.capability}`),
      "X-Zenguy-Worker-Id": workerId,
    };

    const repeatedClaim = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ deliveryId: "cf-message-1", message, workerId }),
    });
    await expect(repeatedClaim.json()).resolves.toMatchObject({
      data: { disposition: "EXECUTE" },
    });
    const competingClaim = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ deliveryId: "cf-message-2", message, workerId }),
    });
    await expect(competingClaim.json()).resolves.toEqual({
      data: { disposition: "SKIP" },
    });

    const started = await app.request(
      `/api/runner/attempts/${message.attemptId}/start`,
      {
        method: "POST",
        headers: jobHeaders,
        body: JSON.stringify({ reference }),
      },
    );
    expect(started.status).toBe(200);
    await expect(started.json()).resolves.toMatchObject({
      data: { disposition: "STARTED", startedAt: NOW, secrets: [] },
    });

    const step = await app.request(
      `/api/runner/attempts/${message.attemptId}/steps`,
      {
        method: "POST",
        headers: jobHeaders,
        body: JSON.stringify({
          reference,
          step: {
            sequence: 1,
            actionType: "navigate",
            description: "Opened the checkout",
            url: TEST.startUrl,
            result: "OK",
            screenshotJpegBase64: null,
          },
        }),
      },
    );
    expect(step.status).toBe(200);

    const completed = await app.request(
      `/api/runner/attempts/${message.attemptId}/complete`,
      {
        method: "POST",
        headers: jobHeaders,
        body: JSON.stringify({
          reference,
          outcome: {
            status: "PASSED",
            summary: "Checkout is available",
            expectedResult: "Checkout loads",
            actualResult: "Checkout loaded",
            tokenUsage: 120,
            modelName: "qwen3:8b",
            runnerVersion: "zenguy-local-runner/1.0.0",
            visitedUrls: [TEST.startUrl],
            consoleErrors: [],
            networkErrors: [],
          },
        }),
      },
    );
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toEqual({
      data: { disposition: "COMPLETED" },
    });

    await expect(runs.findById(WORKSPACE.id, createdBody.data.runId)).resolves.toMatchObject({
      status: "PASSED",
      attemptCount: 1,
      billable: true,
    });
    await expect(attempts.findById(message.attemptId)).resolves.toMatchObject({
      status: "PASSED",
      modelName: "qwen3:8b",
      runnerVersion: "zenguy-local-runner/1.0.0",
    });
    await expect(
      new D1StepRepo(testEnv().DB).listForAttempt(message.attemptId),
    ).resolves.toEqual([
      expect.objectContaining({
        sequence: 1,
        actionType: "navigate",
        description: "Opened the checkout",
        result: "OK",
      }),
    ]);
  });

  it("hands unclaimed attempts to the fallback runner only after the delay", async () => {
    await new D1RemoteAiConsentRepo(testEnv().DB).grant({
      workspaceId: WORKSPACE.id,
      provider: REMOTE_AI_PROVIDER,
      policyVersion: REMOTE_AI_CONSENT_VERSION,
      actorUserId: OWNER.id,
      at: NOW,
    });
    const created = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
      { method: "POST", headers: headers(ownerToken) },
    );
    expect(created.status).toBe(202);
    const message = queue.messages[0];
    if (message === undefined) throw new Error("Run message missing");
    const workerId = "fallback-vps-1";
    const fallbackHeaders = headers(
      `Bearer ${"fallback-runner-test-secret".padEnd(32, "-")}`,
    );

    const early = await app.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: fallbackHeaders,
      body: JSON.stringify({ deliveryId: "fallback-delivery-1", workerId }),
    });
    expect(early.status).toBe(200);
    await expect(early.json()).resolves.toEqual({
      data: { disposition: "SKIP" },
    });

    const laterApp = buildApp(testEnv(), {
      clock: new FixedClock(NOW + FALLBACK_CLAIM_MIN_AGE_MS),
      ids: new FakeIds(),
      runQueue: queue,
    });
    const claimed = await laterApp.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: fallbackHeaders,
      body: JSON.stringify({ deliveryId: "fallback-delivery-1", workerId }),
    });
    expect(claimed.status).toBe(200);
    const claimedBody = (await claimed.json()) as {
      data: { disposition: string; job: { reference: Record<string, unknown> } };
    };
    expect(claimedBody.data).toMatchObject({
      disposition: "EXECUTE",
      job: {
        reference: {
          runId: message.runId,
          attemptId: message.attemptId,
          attemptIndex: 0,
          executionGeneration: message.executionGeneration,
          deliveryId: "fallback-delivery-1",
        },
        snapshot: { startUrl: TEST.startUrl },
      },
    });
    await expect(attempts.findById(message.attemptId)).resolves.toMatchObject({
      status: "STARTING",
    });

    const localClaim = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers(`Bearer ${"runner-test-secret".padEnd(32, "-")}`),
      body: JSON.stringify({
        deliveryId: "cf-late-delivery",
        message,
        workerId: "primary-mac-1",
      }),
    });
    await expect(localClaim.json()).resolves.toEqual({
      data: { disposition: "SKIP" },
    });
  });

  it("keeps the initial attempt recoverable when Queue.send fails", async () => {
    queue.failures = 1;
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
      { method: "POST", headers: headers(ownerToken) },
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { data: { runId: string } };
    const [attempt] = await attempts.listForRun(body.data.runId);
    expect(attempt).toMatchObject({ status: "QUEUED", attemptIndex: 0 });
    const durable = new D1DurableWorkflowRepo(testEnv().DB);
    const pending = await durable.listPending(10, NOW, NOW);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      queueKind: "RUN",
      publishingAt: null,
      publishedAt: null,
    });

    const unusedQueue = {
      send: async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    };
    const publisher = new PublishQueueOutbox(
      durable,
      { RUN: queue, CHECK: unusedQueue, NOTIFY: unusedQueue },
      new FixedClock(NOW),
    );
    await expect(publisher.flush()).resolves.toMatchObject({ published: 1 });
    expect(queue.messages).toEqual([
      {
        kind: "attempt",
        runId: body.data.runId,
        attemptId: attempt?.id,
        attemptIndex: 0,
        executionGeneration: attempt?.queuedAt,
      },
    ]);
    alert.mockRestore();
  });

  it("creates validation runs with a null test id and draft snapshot", async () => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/validate`,
      {
        method: "POST",
        headers: headers(ownerToken),
        body: JSON.stringify(DRAFT),
      },
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { data: { runId: string } };
    await expect(runs.findById(WORKSPACE.id, body.data.runId)).resolves.toMatchObject({
      browserTestId: null,
      source: "VALIDATION",
      snapshot: {
        name: DRAFT.name,
        device: "MOBILE",
        channelIds: [],
        viewport: { width: 390, height: 844 },
      },
    });
    await expect(attempts.listForRun(body.data.runId)).resolves.toHaveLength(1);
    expect(queue.messages[0]).toMatchObject({
      kind: "attempt",
      runId: body.data.runId,
      attemptIndex: 0,
    });
  });

  it("requires a fresh human confirmation before funding exact draft scopes", async () => {
    const scopedDraft = {
      ...DRAFT,
      writableDomains: ["shop.example.com"],
      testDataAttested: true,
      irreversibleActionScopes: [
        {
          kind: "HTTP" as const,
          method: "POST" as const,
          origin: "https://shop.example.com",
          path: "/orders",
          maxUses: 1,
        },
      ],
    };
    const unapprovedResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/validate`,
      {
        method: "POST",
        headers: headers(ownerToken),
        body: JSON.stringify(scopedDraft),
      },
    );
    const unapprovedBody = (await unapprovedResponse.json()) as {
      data: { runId: string };
    };
    const unapproved = await runs.findById(
      WORKSPACE.id,
      unapprovedBody.data.runId,
    );
    expect(unapproved?.snapshot.irreversibleAuthorization).toBeUndefined();
    expect(unapproved?.actionAuthorizations).toEqual([]);

    const approvedResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/validate`,
      {
        method: "POST",
        headers: headers(ownerToken),
        body: JSON.stringify({
          config: scopedDraft,
          approveIrreversibleActions: true,
        }),
      },
    );
    expect(approvedResponse.status).toBe(202);
    const approvedBody = (await approvedResponse.json()) as {
      data: { runId: string };
    };
    const approved = await runs.findById(
      WORKSPACE.id,
      approvedBody.data.runId,
    );
    expect(approved?.actionAuthorizations).toEqual([
      { scope: scopedDraft.irreversibleActionScopes[0], remainingUses: 1 },
    ]);
    expect(
      approved === null
        ? false
        : await verifyIrreversibleRunAuthorization(
            approved.snapshot,
            loadConfig(testEnv()).runnerCapabilitySecret,
          ),
    ).toBe(true);
  });

  it("returns 403 for members and 402 without a subscription", async () => {
    const memberResponses = await Promise.all([
      app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
        { method: "POST", headers: headers(memberToken) },
      ),
      app.request(`/api/workspaces/${WORKSPACE.id}/browser-tests/validate`, {
        method: "POST",
        headers: headers(memberToken),
        body: JSON.stringify(DRAFT),
      }),
    ]);
    expect(memberResponses.map(({ status }) => status)).toEqual([403, 403]);

    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      status: "CANCELED",
      updatedAt: 2,
    });
    const billingResponses = await Promise.all([
      app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
        { method: "POST", headers: headers(ownerToken) },
      ),
      app.request(`/api/workspaces/${WORKSPACE.id}/browser-tests/validate`, {
        method: "POST",
        headers: headers(ownerToken),
        body: JSON.stringify(DRAFT),
      }),
    ]);
    expect(billingResponses.map(({ status }) => status)).toEqual([402, 402]);
    expect(queue.messages).toHaveLength(0);
  });

  it("shares the ten-per-minute workspace rate limit", async () => {
    for (let count = 0; count < 10; count += 1) {
      const response = await app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests/validate`,
        {
          method: "POST",
          headers: headers(ownerToken),
          body: JSON.stringify({ ...DRAFT, name: `Draft ${count}` }),
        },
      );
      expect(response.status).toBe(202);
    }
    const blocked = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
      {
        method: "POST",
        headers: headers(ownerToken),
      },
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(queue.messages).toHaveLength(10);
  });
});
