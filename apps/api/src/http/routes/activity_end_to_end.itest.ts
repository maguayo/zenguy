import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ActivityEventRepo } from "../../infrastructure/db/activity_event_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock, systemClock } from "../../shared/clock";
import { loadConfig, type Bindings } from "../../shared/config";
import { hashPassword } from "../../shared/crypto";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

/**
 * Drives real HTTP requests through `buildApp` and asserts the activity rows
 * that the production composition root produces: an explicit emission point
 * (login), the `WriteAudit` bridge (create) and a system-originated fact
 * carried through the runner lifecycle (terminal run outcome).
 */
const NOW = Date.parse("2026-08-23T10:00:00.000Z");
const PASSWORD = "activity-e2e-password";
const OWNER: User = {
  id: "usr_activity_e2e_owner",
  name: "Activity Owner",
  email: "owner@activity-e2e.test",
  passwordHash: "replaced in beforeAll",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const WORKSPACE: Workspace = {
  id: "ws_activity_e2e",
  name: "Activity E2E Workspace",
  slug: "activity-e2e-workspace",
  timezone: "UTC",
  ownerUserId: OWNER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_activity_e2e",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_activity_e2e",
  providerSubscriptionId: "sub_provider_activity_e2e",
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
  id: "bt_activity_e2e",
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
const CREATE_BODY = {
  name: "Login smoke",
  startUrl: "https://shop.example.com/login",
  instructions: "Sign in and verify the account page",
  device: "DESKTOP",
  intervalHours: 12,
  maxRetries: 1,
  notifyOnRecovery: false,
  channelIds: [],
} as const;
const RUNNER_TOKEN = "runner-test-secret".padEnd(32, "-");
const WORKER_ID = "primary-mac-1";

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

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

describe("activity events end to end", () => {
  let bindings: Bindings;
  let app: Hono<AppEnv>;
  let queue: RecordingRunQueue;
  let ownerToken: string;
  let passwordHash: string;

  const activity = () => new D1ActivityEventRepo(bindings.DB);

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    await freshDb();
    bindings = testEnv();
    const config = loadConfig(bindings);
    const clock = new FixedClock(NOW);
    await new D1UserRepo(bindings.DB).insert({ ...OWNER, passwordHash });
    await new D1WorkspaceRepo(bindings.DB).insert(WORKSPACE);
    await new D1MemberRepo(bindings.DB).insert({
      id: "mem_activity_e2e_owner",
      workspaceId: WORKSPACE.id,
      userId: OWNER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    await new D1BrowserTestRepo(bindings.DB).insert(TEST);
    queue = new RecordingRunQueue();
    // hono/jwt checks `exp` against the real clock, so the bearer token is
    // issued from it while the app keeps a fixed clock for stable timestamps.
    ownerToken = `Bearer ${await issueAccessToken(config, OWNER, systemClock)}`;
    app = buildApp(bindings, { clock, ids: new FakeIds(), runQueue: queue });
  });

  it("records user.logged_in on password login", async () => {
    const response = await app.request(
      "/api/auth/login",
      json(
        { email: OWNER.email, password: PASSWORD },
        { "CF-Connecting-IP": "198.51.100.20" },
      ),
    );
    expect(response.status).toBe(200);

    const rows = await activity().listRecent(10);
    expect(
      rows.map((row) => [row.type, row.source, row.userId, row.workspaceId]),
    ).toEqual([["user.logged_in", "web", OWNER.id, null]]);
    expect(rows[0]).toMatchObject({
      resourceType: null,
      resourceId: null,
      propertiesJson: null,
      occurredAt: NOW,
    });
  });

  it("bridges browser_test.created from the audited create use case", async () => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests`,
      json(CREATE_BODY, { Authorization: ownerToken }),
    );
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { id: string } };

    const rows = await activity().listRecent(10);
    expect(rows).toEqual([
      {
        id: expect.stringMatching(/^act_/u),
        type: "browser_test.created",
        userId: OWNER.id,
        workspaceId: WORKSPACE.id,
        source: "server",
        resourceType: "browser_test",
        resourceId: data.id,
        propertiesJson: JSON.stringify({ name: CREATE_BODY.name }),
        occurredAt: NOW,
      },
    ]);
  });

  it("records the terminal run outcome with the triggering user", async () => {
    const requested = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/run-now`,
      { method: "POST", headers: { Authorization: ownerToken } },
    );
    expect(requested.status).toBe(202);
    const { data } = (await requested.json()) as { data: { runId: string } };
    const message = queue.messages[0];
    if (message === undefined) throw new Error("Run message missing");

    const runnerHeaders = { Authorization: `Bearer ${RUNNER_TOKEN}` };
    const claimed = await app.request(
      "/api/runner/attempts/claim",
      json({ deliveryId: "cf-message-1", message, workerId: WORKER_ID }, runnerHeaders),
    );
    expect(claimed.status).toBe(200);
    const claim = (await claimed.json()) as {
      data: {
        disposition: string;
        job: { capability: string; reference: Record<string, unknown> };
      };
    };
    expect(claim.data.disposition).toBe("EXECUTE");
    const reference = claim.data.job.reference;
    const jobHeaders = {
      Authorization: `Bearer ${claim.data.job.capability}`,
      "X-Zenguy-Worker-Id": WORKER_ID,
    };

    const started = await app.request(
      `/api/runner/attempts/${message.attemptId}/start`,
      json({ reference }, jobHeaders),
    );
    expect(started.status).toBe(200);
    const completed = await app.request(
      `/api/runner/attempts/${message.attemptId}/complete`,
      json(
        {
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
        },
        jobHeaders,
      ),
    );
    expect(completed.status).toBe(200);
    await expect(
      new D1RunRepo(bindings.DB).findById(WORKSPACE.id, data.runId),
    ).resolves.toMatchObject({ status: "PASSED", source: "MANUAL" });

    // The manual trigger is an audited mutation (bridged); the outcome is a
    // system fact emitted by the lifecycle once the run is finalized.
    const rows = await activity().listRecent(10);
    expect(rows.map((row) => row.type)).toEqual([
      "browser_test.run_passed",
      "browser_test.run_requested",
    ]);
    const passed = rows[0];
    expect(passed).toMatchObject({
      userId: OWNER.id,
      workspaceId: WORKSPACE.id,
      source: "server",
      resourceType: "browser_test",
      resourceId: TEST.id,
      occurredAt: NOW,
    });
    const properties = JSON.parse(passed?.propertiesJson ?? "null") as Record<
      string,
      unknown
    >;
    expect(properties).toMatchObject({
      runId: data.runId,
      runSource: "MANUAL",
      attemptCount: 1,
      durationMs: 0,
    });
    expect(Object.keys(properties).sort()).toEqual([
      "attemptCount",
      "durationMs",
      "retried",
      "runId",
      "runSource",
    ]);
    expect(rows[1]).toMatchObject({
      userId: OWNER.id,
      workspaceId: WORKSPACE.id,
      source: "server",
      resourceType: "browser_test",
      resourceId: TEST.id,
    });
  });
});
