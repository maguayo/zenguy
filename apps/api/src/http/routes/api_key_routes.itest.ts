import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type {
  BrowserTest,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ApiKeyRepo } from "../../infrastructure/db/api_key_repo";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import type { RateLimiter } from "../../shared/ratelimit";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member" | "ownerB";
const NOW = Date.now();
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_ak_owner",
    name: "Owner",
    email: "owner@apikeys.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  admin: {
    id: "usr_ak_admin",
    name: "Admin",
    email: "admin@apikeys.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  member: {
    id: "usr_ak_member",
    name: "Member",
    email: "member@apikeys.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  ownerB: {
    id: "usr_ak_owner_b",
    name: "Owner B",
    email: "owner-b@apikeys.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
};
const WORKSPACE: Workspace = {
  id: "ws_ak_primary",
  name: "API Keys Workspace",
  slug: "api-keys-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const WORKSPACE_B: Workspace = {
  id: "ws_ak_other",
  name: "Other Workspace",
  slug: "api-keys-other",
  timezone: "UTC",
  ownerUserId: USERS.ownerB.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const TEST_ID = "bt_ak_primary";
const RUN_ID = "run_ak_primary";

function subscription(workspaceId: string, active = true): Subscription {
  return {
    id: `sub_${workspaceId}`,
    workspaceId,
    provider: "paddle",
    providerCustomerId: `ctm_${workspaceId}`,
    providerSubscriptionId: `provider_${workspaceId}`,
    status: active ? "ACTIVE" : "CANCELED",
    periodStart: 1,
    periodEnd: 9_999_999_999_999,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function monitor(id: string, workspaceId: string, name: string): UptimeMonitor {
  return {
    id,
    workspaceId,
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
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt: NOW + 300_000,
    currentStatus: "UP",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: NOW,
    lastResponseTimeMs: 40,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

const BROWSER_TEST: BrowserTest = {
  id: TEST_ID,
  workspaceId: WORKSPACE.id,
  name: "Checkout flow",
  startUrl: "https://example.com",
  instructions: "Verify the Example Domain heading",
  device: "DESKTOP",
  intervalHours: 24,
  maxRetries: 0,
  notifyOnRecovery: true,
  nextRunAt: NOW + 86_400_000,
  createdBy: USERS.owner.id,
  updatedBy: USERS.owner.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const RUN: TestRun = {
  id: RUN_ID,
  workspaceId: WORKSPACE.id,
  browserTestId: TEST_ID,
  source: "MANUAL",
  status: "PASSED",
  snapshot: {
    name: BROWSER_TEST.name,
    startUrl: BROWSER_TEST.startUrl,
    instructions: BROWSER_TEST.instructions,
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 0,
    notifyOnRecovery: true,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: "api-key-itest",
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
  triggeredByUserId: USERS.owner.id,
  incidentId: null,
  createdAt: NOW - 2_000,
};
const ATTEMPT: TestAttempt = {
  id: "att_ak_primary",
  testRunId: RUN_ID,
  attemptIndex: 0,
  status: "PASSED",
  retryDelaySeconds: 0,
  queuedAt: NOW - 2_000,
  startedAt: NOW - 1_000,
  finishedAt: NOW,
  durationMs: 1_000,
  summary: "Passed",
  expectedResult: "Example Domain",
  actualResult: "Example Domain",
  failureReason: null,
  visitedUrlsJson: JSON.stringify(["https://example.com"]),
  consoleErrorsJson: "[]",
  networkErrorsJson: "[]",
  tokenUsage: 10,
  inputTokens: null,
  outputTokens: null,
  modelName: "gpt-5-mini",
  runnerVersion: "api-key-itest",
  runnerKind: null,
  systemErrorCode: null,
  createdAt: NOW - 2_000,
};

class PermissiveRateLimiter implements RateLimiter {
  async hit(): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

class BlockAfterRateLimiter implements RateLimiter {
  readonly counts = new Map<string, number>();

  constructor(private readonly allowed: number) {}

  async hit(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { allowed: count <= this.allowed, retryAfterSeconds: 30 };
  }
}

async function seed() {
  await freshDb();
  const bindings = testEnv();
  const users = new D1UserRepo(bindings.DB);
  for (const user of Object.values(USERS)) await users.insert(user);
  const workspaces = new D1WorkspaceRepo(bindings.DB);
  await workspaces.insert(WORKSPACE);
  await workspaces.insert(WORKSPACE_B);
  const members = new D1MemberRepo(bindings.DB);
  const roles: [Actor, string, Role][] = [
    ["owner", WORKSPACE.id, "OWNER"],
    ["admin", WORKSPACE.id, "ADMIN"],
    ["member", WORKSPACE.id, "MEMBER"],
    ["ownerB", WORKSPACE_B.id, "OWNER"],
  ];
  let sequence = 0;
  for (const [actor, workspaceId, role] of roles) {
    sequence += 1;
    await members.insert({
      id: `mem_ak_${sequence}`,
      workspaceId,
      userId: USERS[actor].id,
      role,
      invitedBy: null,
      joinedAt: sequence,
    });
  }
  const subscriptions = new D1SubscriptionRepo(bindings.DB);
  await subscriptions.upsertByWorkspace(subscription(WORKSPACE.id));
  await subscriptions.upsertByWorkspace(subscription(WORKSPACE_B.id));
  const monitors = new D1MonitorRepo(bindings.DB);
  await monitors.insert(monitor("mon_ak_primary", WORKSPACE.id, "Primary API"));
  await monitors.insert(monitor("mon_ak_other", WORKSPACE_B.id, "Other API"));
  await new D1BrowserTestRepo(bindings.DB).insert(BROWSER_TEST);
  await new D1RunRepo(bindings.DB).insert(RUN);
  await new D1AttemptRepo(bindings.DB).insert(ATTEMPT);

  const config = loadConfig(bindings);
  const tokens: Record<Actor, string> = {
    owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
    admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
    member: `Bearer ${await issueAccessToken(config, USERS.member, systemClock)}`,
    ownerB: `Bearer ${await issueAccessToken(config, USERS.ownerB, systemClock)}`,
  };
  return { bindings, tokens, subscriptions };
}

function headers(token: string): HeadersInit {
  return { Authorization: token, "content-type": "application/json" };
}

async function createKey(
  app: Hono<AppEnv>,
  token: string,
  workspaceId = WORKSPACE.id,
  name = "Status dashboard",
  options: {
    scopes?: ("workspace:read" | "uptime:read" | "tests:read" | "runs:read")[];
    expiresInDays?: number;
  } = {},
): Promise<{ id: string; key: string; scopes: string[]; expiresAt: string }> {
  const response = await app.request(`/api/workspaces/${workspaceId}/api-keys`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ name, ...options }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    data: {
      id: string;
      key: string;
      keyPrefix: string;
      scopes: string[];
      expiresAt: string;
    };
  };
  expect(body.data.key).toMatch(/^zgk_[A-Za-z0-9_-]{43}$/);
  expect(body.data.keyPrefix).toBe(body.data.key.slice(0, 12));
  return {
    id: body.data.id,
    key: body.data.key,
    scopes: body.data.scopes,
    expiresAt: body.data.expiresAt,
  };
}

describe("API key routes", () => {
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;
  let subscriptions: D1SubscriptionRepo;
  let apiKeys: D1ApiKeyRepo;
  let audits: D1AuditRepo;

  beforeEach(async () => {
    const fixture = await seed();
    tokens = fixture.tokens;
    subscriptions = fixture.subscriptions;
    apiKeys = new D1ApiKeyRepo(fixture.bindings.DB);
    audits = new D1AuditRepo(fixture.bindings.DB);
    app = buildApp(fixture.bindings, {
      rateLimiter: new PermissiveRateLimiter(),
    });
  });

  it("creates, lists, and revokes keys without ever storing or re-serving the plaintext", async () => {
    const created = await createKey(app, tokens.owner);
    expect(created.scopes).toEqual([
      "workspace:read",
      "uptime:read",
      "tests:read",
      "runs:read",
    ]);
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.now());

    const stored = await apiKeys.findById(WORKSPACE.id, created.id);
    expect(stored?.keyHash).not.toBe(created.key);
    expect(JSON.stringify(stored)).not.toContain(created.key);
    expect(stored?.createdBy).toBe(USERS.owner.id);

    const listed = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys`,
      { headers: headers(tokens.member) },
    );
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(created.key);
    expect(listedText).not.toContain(stored?.keyHash);
    expect(JSON.parse(listedText)).toMatchObject({
      data: [
        {
          id: created.id,
          name: "Status dashboard",
          keyPrefix: created.key.slice(0, 12),
          createdBy: { userId: USERS.owner.id, name: USERS.owner.name },
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
    });

    const revoked = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys/${created.id}`,
      { method: "DELETE", headers: headers(tokens.admin) },
    );
    expect(revoked.status).toBe(204);
    const emptied = (await (
      await app.request(`/api/workspaces/${WORKSPACE.id}/api-keys`, {
        headers: headers(tokens.owner),
      })
    ).json()) as { data: unknown[] };
    expect(emptied.data).toEqual([]);

    // Idempotent second revoke.
    const again = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys/${created.id}`,
      { method: "DELETE", headers: headers(tokens.owner) },
    );
    expect(again.status).toBe(204);

    const entries = await audits.list(WORKSPACE.id, null, 10);
    expect(entries.map(({ action }) => action)).toEqual([
      "api_key.revoked",
      "api_key.created",
    ]);
    expect(JSON.stringify(entries)).not.toContain(created.key);
  });

  it("enforces explicit read scopes per public API resource", async () => {
    const created = await createKey(
      app,
      tokens.owner,
      WORKSPACE.id,
      "Uptime only",
      { scopes: ["uptime:read"], expiresInDays: 30 },
    );
    const keyHeaders = { Authorization: `Bearer ${created.key}` };

    expect(created.scopes).toEqual(["uptime:read"]);
    expect(
      (await app.request("/api/v1/uptime-monitors", { headers: keyHeaders })).status,
    ).toBe(200);
    const forbidden = await app.request("/api/v1/workspace", {
      headers: keyHeaders,
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("forbids members from creating and revoking but lets them list", async () => {
    const created = await createKey(app, tokens.admin);
    const attempts = [
      app.request(`/api/workspaces/${WORKSPACE.id}/api-keys`, {
        method: "POST",
        headers: headers(tokens.member),
        body: JSON.stringify({ name: "Member key" }),
      }),
      app.request(`/api/workspaces/${WORKSPACE.id}/api-keys/${created.id}`, {
        method: "DELETE",
        headers: headers(tokens.member),
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    const outsider = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys`,
      { headers: headers(tokens.ownerB) },
    );
    expect(outsider.status).toBe(404);
  });

  it("gates creation on an active subscription but always allows revocation", async () => {
    const created = await createKey(app, tokens.owner);
    await subscriptions.upsertByWorkspace(subscription(WORKSPACE.id, false));

    const blocked = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys`,
      {
        method: "POST",
        headers: headers(tokens.owner),
        body: JSON.stringify({ name: "Blocked" }),
      },
    );
    expect(blocked.status).toBe(402);

    const revoked = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys/${created.id}`,
      { method: "DELETE", headers: headers(tokens.owner) },
    );
    expect(revoked.status).toBe(204);
  });

  it("serves the read-only public API scoped to the key's workspace", async () => {
    const created = await createKey(app, tokens.owner);
    const keyHeaders = { Authorization: `Bearer ${created.key}` };

    const workspace = (await (
      await app.request("/api/v1/workspace", { headers: keyHeaders })
    ).json()) as { data: { id: string; name: string } };
    expect(workspace.data).toMatchObject({
      id: WORKSPACE.id,
      name: WORKSPACE.name,
      slug: WORKSPACE.slug,
    });

    const monitors = await app.request("/api/v1/uptime-monitors", {
      headers: { "X-Api-Key": created.key },
    });
    expect(monitors.status).toBe(200);
    const monitorsBody = (await monitors.json()) as {
      data: { id: string; name: string; status: string }[];
    };
    expect(monitorsBody.data.map(({ id }) => id)).toEqual(["mon_ak_primary"]);
    expect(monitorsBody.data[0]).toMatchObject({ status: "UP" });

    const tests = (await (
      await app.request("/api/v1/browser-tests", { headers: keyHeaders })
    ).json()) as { data: { id: string; lastRun: { id: string } | null }[] };
    expect(tests.data.map(({ id }) => id)).toEqual([TEST_ID]);
    expect(tests.data[0]?.lastRun).toMatchObject({ id: RUN_ID });

    const runs = (await (
      await app.request(`/api/v1/browser-tests/${TEST_ID}/runs?limit=10`, {
        headers: keyHeaders,
      })
    ).json()) as { data: { id: string; status: string }[]; nextCursor: null };
    expect(runs.data).toEqual([
      expect.objectContaining({ id: RUN_ID, status: "PASSED" }),
    ]);
    expect(runs.nextCursor).toBeNull();

    const run = (await (
      await app.request(`/api/v1/runs/${RUN_ID}`, { headers: keyHeaders })
    ).json()) as { data: { id: string; attempts: unknown[] } };
    expect(run.data).toMatchObject({ id: RUN_ID, status: "PASSED" });
    expect(run.data.attempts).toHaveLength(1);

    const touched = await apiKeys.findById(WORKSPACE.id, created.id);
    expect(touched?.lastUsedAt).not.toBeNull();
  });

  it("isolates workspaces: a key from B never sees A's data", async () => {
    const keyB = await createKey(app, tokens.ownerB, WORKSPACE_B.id, "B key");
    const keyHeaders = { Authorization: `Bearer ${keyB.key}` };

    const monitors = (await (
      await app.request("/api/v1/uptime-monitors", { headers: keyHeaders })
    ).json()) as { data: { id: string }[] };
    expect(monitors.data.map(({ id }) => id)).toEqual(["mon_ak_other"]);

    const tests = (await (
      await app.request("/api/v1/browser-tests", { headers: keyHeaders })
    ).json()) as { data: unknown[] };
    expect(tests.data).toEqual([]);

    const foreignRun = await app.request(`/api/v1/runs/${RUN_ID}`, {
      headers: keyHeaders,
    });
    expect(foreignRun.status).toBe(404);
    const foreignRuns = await app.request(
      `/api/v1/browser-tests/${TEST_ID}/runs`,
      { headers: keyHeaders },
    );
    expect(foreignRuns.status).toBe(404);
  });

  it("rejects missing, unknown, revoked, and JWT credentials on the public API", async () => {
    const created = await createKey(app, tokens.owner);

    const missing = await app.request("/api/v1/workspace");
    expect(missing.status).toBe(401);

    const unknown = await app.request("/api/v1/workspace", {
      headers: { Authorization: "Bearer zgk_definitely-not-a-real-key-000000000" },
    });
    expect(unknown.status).toBe(401);
    await expect(unknown.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED", message: "Invalid API key" },
    });

    const jwt = await app.request("/api/v1/workspace", {
      headers: { Authorization: tokens.owner },
    });
    expect(jwt.status).toBe(401);

    // An API key is not a session: management routes reject it.
    const keyOnSessionRoute = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys`,
      { headers: { Authorization: `Bearer ${created.key}` } },
    );
    expect(keyOnSessionRoute.status).toBe(401);

    await app.request(`/api/workspaces/${WORKSPACE.id}/api-keys/${created.id}`, {
      method: "DELETE",
      headers: headers(tokens.owner),
    });
    const revoked = await app.request("/api/v1/workspace", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(revoked.status).toBe(401);
  });

  it("rate limits the public API per key", async () => {
    const fixture = await seed();
    const limitedApp = buildApp(fixture.bindings, {
      rateLimiter: new BlockAfterRateLimiter(2),
    });
    const created = await createKey(limitedApp, fixture.tokens.owner);
    const keyHeaders = { Authorization: `Bearer ${created.key}` };

    for (let call = 0; call < 2; call += 1) {
      const ok = await limitedApp.request("/api/v1/workspace", {
        headers: keyHeaders,
      });
      expect(ok.status).toBe(200);
    }
    const blocked = await limitedApp.request("/api/v1/workspace", {
      headers: keyHeaders,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("30");
  });

  it("does not write last_used_at when the public API limiter rejects", async () => {
    const fixture = await seed();
    const limitedApp = buildApp(fixture.bindings, {
      rateLimiter: new BlockAfterRateLimiter(0),
    });
    const created = await createKey(limitedApp, fixture.tokens.owner);
    const lookup = vi.spyOn(D1ApiKeyRepo.prototype, "findByHash");

    const blocked = await limitedApp.request("/api/v1/workspace", {
      headers: { Authorization: `Bearer ${created.key}` },
    });

    expect(blocked.status).toBe(429);
    expect(lookup).not.toHaveBeenCalled();
    const stored = await new D1ApiKeyRepo(fixture.bindings.DB).findById(
      WORKSPACE.id,
      created.id,
    );
    expect(stored?.lastUsedAt).toBeNull();
    lookup.mockRestore();
  });

  it("allows any origin on the public API but keeps the SPA policy elsewhere", async () => {
    const preflight = await app.request("/api/v1/uptime-monitors", {
      method: "OPTIONS",
      headers: {
        Origin: "https://customer-dashboard.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Api-Key",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(
      preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase(),
    ).toContain("x-api-key");

    const created = await createKey(app, tokens.owner);
    const read = await app.request("/api/v1/workspace", {
      headers: {
        Authorization: `Bearer ${created.key}`,
        Origin: "https://customer-dashboard.example",
      },
    });
    expect(read.status).toBe(200);
    expect(read.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const management = await app.request(
      `/api/workspaces/${WORKSPACE.id}/api-keys`,
      {
        headers: {
          ...headers(tokens.owner),
          Origin: "https://customer-dashboard.example",
        },
      },
    );
    expect(management.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
