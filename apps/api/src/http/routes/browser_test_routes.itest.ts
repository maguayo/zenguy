import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { IncidentCloserOnDelete } from "../../application/browser_tests/incident_closer";
import type { Subscription } from "../../domain/billing/types";
import type { RunSnapshot, TestRun } from "../../domain/browser_tests/types";
import type { NotificationChannel } from "../../domain/channels/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { encryptSecret } from "../../shared/crypto";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";
const NOW = Date.now();
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_tests_owner",
    name: "Owner",
    email: "owner@tests.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  admin: {
    id: "usr_tests_admin",
    name: "Admin",
    email: "admin@tests.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  member: {
    id: "usr_tests_member",
    name: "Member",
    email: "member@tests.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
};
const ROLES: Record<Actor, Role> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};
const WORKSPACE: Workspace = {
  id: "ws_tests",
  name: "Tests Workspace",
  slug: "tests-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const OTHER_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_tests_other",
  slug: "tests-workspace-other",
};
const SUBSCRIPTION: Subscription = {
  id: "sub_tests",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_tests",
  providerSubscriptionId: "sub_provider_tests",
  status: "ACTIVE",
  periodStart: 1,
  periodEnd: 9_999_999_999_999,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: 1,
  updatedAt: 1,
};
const CONFIG = {
  name: "Checkout",
  startUrl: "https://shop.example.com/checkout",
  instructions: "Complete checkout and verify the confirmation",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 2,
  notifyOnRecovery: true,
  channelIds: ["ch_tests"],
} as const;

class RecordingIncidentCloser implements IncidentCloserOnDelete {
  readonly calls: { workspaceId: string; testId: string; at: number }[] = [];

  async closeForTest(input: {
    workspaceId: string;
    testId: string;
    at: number;
  }): Promise<void> {
    this.calls.push({ ...input });
  }
}

function channel(
  id: string,
  workspaceId: string,
  encryptedConfig: string,
): NotificationChannel {
  return {
    id,
    workspaceId,
    name: id,
    type: "EMAIL",
    encryptedConfig,
    enabled: true,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: USERS.owner.id,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("browser test routes", () => {
  let app: Hono<AppEnv>;
  let clock: FixedClock;
  let tokens: Record<Actor, string>;
  let tests: D1BrowserTestRepo;
  let runs: D1RunRepo;
  let subscriptions: D1SubscriptionRepo;
  let audits: D1AuditRepo;
  let incidents: RecordingIncidentCloser;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    await workspaces.insert(OTHER_WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_tests_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: sequence,
      });
    }
    subscriptions = new D1SubscriptionRepo(bindings.DB);
    await subscriptions.upsertByWorkspace(SUBSCRIPTION);
    const channels = new D1ChannelRepo(bindings.DB);
    const encryptedEmail = await encryptSecret(
      JSON.stringify({ emails: ["ops@example.com"] }),
      config.encryptionKey,
    );
    await channels.insert(channel("ch_tests", WORKSPACE.id, encryptedEmail));
    await channels.insert(
      channel("ch_other_workspace", OTHER_WORKSPACE.id, encryptedEmail),
    );
    tests = new D1BrowserTestRepo(bindings.DB);
    runs = new D1RunRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    incidents = new RecordingIncidentCloser();
    clock = new FixedClock(NOW);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, clock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, clock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, clock)}`,
    };
    app = buildApp(bindings, {
      clock,
      ids: new FakeIds(),
      incidentCloserOnTestDelete: incidents,
    });
  });

  function headers(actor: Actor): HeadersInit {
    return {
      Authorization: tokens[actor],
      "content-type": "application/json",
    };
  }

  async function create(
    config: Record<string, unknown> = CONFIG,
    actor: Actor = "owner",
  ): Promise<{ id: string; body: { data: Record<string, unknown> } }> {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests`,
      {
        method: "POST",
        headers: headers(actor),
        body: JSON.stringify(config),
      },
    );
    const body = (await response.json()) as {
      data: Record<string, unknown>;
    };
    expect(response.status).toBe(201);
    return { id: String(body.data.id), body };
  }

  it("validates channel ownership and creates a scheduled test", async () => {
    for (const channelIds of [["ch_missing"], ["ch_other_workspace"]]) {
      const response = await app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests`,
        {
          method: "POST",
          headers: headers("owner"),
          body: JSON.stringify({ ...CONFIG, channelIds }),
        },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: [{ field: "channelIds" }],
        },
      });
    }

    const created = await create({
      ...CONFIG,
      name: " Checkout ",
      channelIds: ["ch_tests", "ch_tests"],
    });
    expect(created.body).toMatchObject({
      data: {
        name: "Checkout",
        channelIds: ["ch_tests"],
        nextRunAt: new Date(NOW + 6 * 3_600_000).toISOString(),
        createdBy: { userId: USERS.owner.id, name: USERS.owner.name },
        lastRun: null,
        openIncidentId: null,
      },
    });
    await expect(tests.findById(WORKSPACE.id, created.id)).resolves.toMatchObject({
      nextRunAt: NOW + 6 * 3_600_000,
      createdBy: USERS.owner.id,
      updatedBy: USERS.owner.id,
    });
    await expect(tests.getChannelIds(created.id)).resolves.toEqual([
      "ch_tests",
    ]);
    const entries = await audits.list(WORKSPACE.id, null, 10);
    expect(entries[0]).toMatchObject({
      action: "test.created",
      resourceId: created.id,
    });
  });

  it("recomputes scheduling on interval changes without mutating run snapshots", async () => {
    const created = await create();
    const originalSnapshot: RunSnapshot = {
      ...CONFIG,
      channelIds: ["ch_tests"],
      viewport: { width: 1440, height: 900 },
      modelName: "gpt-5-mini",
      runnerVersion: "zenguy-runner/1.0.0",
    };
    const historical: TestRun = {
      id: "run_historical",
      workspaceId: WORKSPACE.id,
      browserTestId: created.id,
      source: "MANUAL",
      status: "PASSED",
      snapshot: originalSnapshot,
      scheduledFor: null,
      queuedAt: NOW,
      startedAt: NOW,
      finishedAt: NOW + 100,
      durationMs: 100,
      attemptCount: 1,
      infraAttempts: 0,
      passedAfterRetry: false,
      billable: true,
      usageEventId: "ue_historical",
      triggeredByUserId: USERS.owner.id,
      incidentId: null,
      createdAt: NOW + 1,
    };
    await runs.insert(historical);
    clock.advance(1_000);

    const updated = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
      {
        method: "PATCH",
        headers: headers("admin"),
        body: JSON.stringify({
          name: "Checkout mobile",
          device: "MOBILE",
          intervalHours: 2,
          channelIds: [],
        }),
      },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        name: "Checkout mobile",
        device: "MOBILE",
        intervalHours: 2,
        channelIds: [],
        nextRunAt: new Date(clock.now() + 2 * 3_600_000).toISOString(),
        lastRun: {
          id: historical.id,
          status: "PASSED",
          source: "MANUAL",
        },
      },
    });
    await expect(tests.findById(WORKSPACE.id, created.id)).resolves.toMatchObject({
      nextRunAt: clock.now() + 2 * 3_600_000,
      updatedBy: USERS.admin.id,
    });
    await expect(runs.findById(WORKSPACE.id, historical.id)).resolves.toMatchObject({
      snapshot: originalSnapshot,
    });

    for (const path of [
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
      `/api/workspaces/${WORKSPACE.id}/browser-tests`,
    ]) {
      const response = await app.request(path, { headers: headers("member") });
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain(
        "run_historical",
      );
    }
  });

  it("soft-deletes tests, hides them from reads, and invokes incident cleanup", async () => {
    const created = await create();
    clock.advance(2_000);
    const deleted = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
      { method: "DELETE", headers: headers("admin") },
    );
    expect(deleted.status).toBe(204);
    expect(incidents.calls).toEqual([
      { workspaceId: WORKSPACE.id, testId: created.id, at: clock.now() },
    ]);
    await expect(tests.findById(WORKSPACE.id, created.id)).resolves.toBeNull();
    const raw = await testEnv()
      .DB.prepare("SELECT deleted_at FROM browser_tests WHERE id = ?")
      .bind(created.id)
      .first<{ deleted_at: number | null }>();
    expect(raw?.deleted_at).toBe(clock.now());
    const detail = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
      { headers: headers("member") },
    );
    expect(detail.status).toBe(404);
    const list = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests`,
      { headers: headers("member") },
    );
    await expect(list.json()).resolves.toEqual({ data: [] });
  });

  it("allows member reads but forbids every mutation", async () => {
    const created = await create();
    const attempts = [
      app.request(`/api/workspaces/${WORKSPACE.id}/browser-tests`, {
        method: "POST",
        headers: headers("member"),
        body: JSON.stringify(CONFIG),
      }),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
        {
          method: "PATCH",
          headers: headers("member"),
          body: JSON.stringify({ name: "Forbidden" }),
        },
      ),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
        { method: "DELETE", headers: headers("member") },
      ),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }
    expect(
      (
        await app.request(`/api/workspaces/${WORKSPACE.id}/browser-tests`, {
          headers: headers("member"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
          { headers: headers("member") },
        )
      ).status,
    ).toBe(200);
  });

  it("requires an active subscription for mutations while preserving reads", async () => {
    const created = await create();
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      status: "CANCELED",
      updatedAt: 2,
    });
    const mutationResponses = await Promise.all([
      app.request(`/api/workspaces/${WORKSPACE.id}/browser-tests`, {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify(CONFIG),
      }),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
        {
          method: "PATCH",
          headers: headers("owner"),
          body: JSON.stringify({ name: "Blocked" }),
        },
      ),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
        { method: "DELETE", headers: headers("owner") },
      ),
    ]);
    expect(mutationResponses.map(({ status }) => status)).toEqual([
      402, 402, 402,
    ]);
    expect(
      (
        await app.request(
          `/api/workspaces/${WORKSPACE.id}/browser-tests/${created.id}`,
          { headers: headers("member") },
        )
      ).status,
    ).toBe(200);
  });
});
