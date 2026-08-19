import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
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

  async send(
    message: AttemptMessage,
    _options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
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
        runnerVersion: "zenguy-runner/1.0.0",
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
      `/api/workspaces/${WORKSPACE.id}/browser-tests/validate`,
      {
        method: "POST",
        headers: headers(ownerToken),
        body: JSON.stringify(DRAFT),
      },
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(queue.messages).toHaveLength(10);
  });
});
