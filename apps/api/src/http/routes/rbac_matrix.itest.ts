import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type {
  BrowserTest,
  RunArtifact,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { NotificationChannel } from "../../domain/channels/types";
import type { Incident, IncidentEvent } from "../../domain/incidents/types";
import type { WorkspaceApiKey } from "../../domain/api_keys/types";
import type { WorkspaceSecret } from "../../domain/secrets/types";
import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type {
  Role,
  Workspace,
  WorkspaceInvitation,
} from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ApiKeyRepo } from "../../infrastructure/db/api_key_repo";
import { D1ArtifactRepo } from "../../infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1CheckRepo } from "../../infrastructure/db/check_repo";
import { D1EmailTokenRepo } from "../../infrastructure/db/email_token_repo";
import { D1IncidentEventRepo } from "../../infrastructure/db/incident_event_repo";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1InvitationRepo } from "../../infrastructure/db/invitation_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import { D1RefreshTokenRepo } from "../../infrastructure/db/refresh_token_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SecretRepo } from "../../infrastructure/db/secret_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import {
  encryptSecret,
  hashPassword,
  hmacSha256Hex,
  hmacSign,
  sha256Hex,
} from "../../shared/crypto";
import { RecordingBillingCanceller, RecordingPaddleClient } from "../../test/fakes/billing";
import { RecordingEmailSender } from "../../test/fakes/email";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import { signArtifactUrl } from "../artifact_sign";

type Caller = "owner" | "admin" | "member" | "outsider" | "unauthenticated";
type Access = "P" | "A" | "M" | "OWNER_ADMIN" | "OWNER";

interface MatrixFixture {
  app: ReturnType<typeof buildApp>;
  authorization: Partial<Record<Caller, string>>;
  invitationToken: string;
  refreshToken: string;
  config: ReturnType<typeof loadConfig>;
}

interface RouteCase {
  label: string;
  access: Access;
  success: number;
  subscription?: true;
  request: (
    fixture: MatrixFixture,
    caller: Caller,
  ) => Promise<{ path: string; init?: RequestInit }>;
}

const NOW = Date.now();
const PASSWORD = "matrix-password-123";
const WORKSPACE: Workspace = {
  id: "ws_rbac_matrix",
  name: "RBAC Matrix",
  slug: "rbac-matrix",
  timezone: "UTC",
  ownerUserId: "usr_rbac_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const INVITE_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_rbac_invite",
  name: "RBAC Invitation",
  slug: "rbac-invitation",
  ownerUserId: "usr_rbac_target",
};
const USERS: Record<Exclude<Caller, "unauthenticated"> | "target" | "auth", User> = {
  owner: {
    id: "usr_rbac_owner",
    name: "Matrix Owner",
    email: "owner@rbac.test",
    passwordHash: "",
    emailVerifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  admin: {
    id: "usr_rbac_admin",
    name: "Matrix Admin",
    email: "admin@rbac.test",
    passwordHash: "",
    emailVerifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  member: {
    id: "usr_rbac_member",
    name: "Matrix Member",
    email: "member@rbac.test",
    passwordHash: "",
    emailVerifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  outsider: {
    id: "usr_rbac_outsider",
    name: "Matrix Outsider",
    email: "outsider@rbac.test",
    passwordHash: "",
    emailVerifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  target: {
    id: "usr_rbac_target",
    name: "Matrix Target",
    email: "target@rbac.test",
    passwordHash: "",
    emailVerifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
  auth: {
    id: "usr_rbac_auth",
    name: "Matrix Auth Target",
    email: "auth-target@rbac.test",
    passwordHash: "",
    emailVerifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
};
const ROLE: Record<"owner" | "admin" | "member", Role> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};
const CHANNEL_ID = "ch_rbac_matrix";
const SECRET_ID = "sec_rbac_matrix";
const API_KEY_ID = "ak_rbac_matrix";
const TEST_ID = "bt_rbac_matrix";
const RUN_ID = "run_rbac_matrix";
const ATTEMPT_ID = "att_rbac_matrix";
const SCREENSHOT_ID = "art_rbac_matrix";
const REPORT_ID = "art_rbac_report";
const MONITOR_ID = "mon_rbac_matrix";
const CHECK_ID = "chk_rbac_matrix";
const INCIDENT_ID = "inc_rbac_matrix";
const INVITATION_ID = "inv_rbac_matrix";
const PUBLIC_INVITATION_ID = "inv_rbac_public";
const PUBLIC_INVITATION_TOKEN = "rbac-public-invitation-token";
const REFRESH_TOKEN = "rbac-refresh-token";
const VERIFY_TOKEN = "rbac-verify-token";
const RESET_TOKEN = "rbac-reset-token";

const BROWSER_CONFIG = {
  name: "Matrix browser test",
  startUrl: "https://example.com",
  instructions: "Verify the Example Domain heading",
  device: "DESKTOP",
  intervalHours: 24,
  maxRetries: 0,
  notifyOnRecovery: true,
  channelIds: [],
} as const;
const MONITOR_CONFIG = {
  name: "Matrix monitor",
  url: "https://example.com/health",
  method: "GET",
  expectedStatus: 200,
  frequencySeconds: 300,
  timeoutSeconds: 10,
  maxRetries: 0,
  notifyOnRecovery: true,
  channelIds: [],
} as const;

let passwordHash = "";

function json(method: string, value: object): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

function subscription(active: boolean): Subscription {
  return {
    id: "sub_rbac_matrix",
    workspaceId: WORKSPACE.id,
    provider: "paddle",
    providerCustomerId: "ctm_rbac_matrix",
    providerSubscriptionId: "provider_sub_rbac_matrix",
    status: active ? "ACTIVE" : "CANCELED",
    periodStart: NOW - 86_400_000,
    periodEnd: NOW + 30 * 86_400_000,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: "https://paddle.test/update",
    cancelUrl: "https://paddle.test/cancel",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function expectedStatus(route: RouteCase, caller: Caller): number {
  if (route.access === "P") return route.success;
  if (caller === "unauthenticated") return 401;
  if (route.access === "A") return route.success;
  if (caller === "outsider") return 404;
  if (route.access === "M") return route.success;
  if (route.access === "OWNER_ADMIN") {
    return caller === "member" ? 403 : route.success;
  }
  return caller === "owner" ? route.success : 403;
}

async function seedFixture(
  caller: Caller,
  activeSubscription = true,
): Promise<MatrixFixture> {
  await Promise.all([freshDb(), freshKv()]);
  const bindings = testEnv();
  const config = loadConfig(bindings);
  const clock = new FixedClock(NOW);
  const users = new D1UserRepo(bindings.DB);
  for (const user of Object.values(USERS)) {
    await users.insert({ ...user, passwordHash });
  }

  const workspaces = new D1WorkspaceRepo(bindings.DB);
  await workspaces.insert(WORKSPACE);
  await workspaces.insert(INVITE_WORKSPACE);
  const members = new D1MemberRepo(bindings.DB);
  for (const actor of ["owner", "admin", "member"] as const) {
    await members.insert({
      id: `mem_rbac_${actor}`,
      workspaceId: WORKSPACE.id,
      userId: USERS[actor].id,
      role: ROLE[actor],
      invitedBy: actor === "owner" ? null : USERS.owner.id,
      joinedAt: NOW,
    });
  }
  await members.insert({
    id: "mem_rbac_target",
    workspaceId: WORKSPACE.id,
    userId: USERS.target.id,
    role: "MEMBER",
    invitedBy: USERS.owner.id,
    joinedAt: NOW,
  });
  await members.insert({
    id: "mem_rbac_invite_owner",
    workspaceId: INVITE_WORKSPACE.id,
    userId: USERS.target.id,
    role: "OWNER",
    invitedBy: null,
    joinedAt: NOW,
  });
  await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(
    subscription(activeSubscription),
  );

  const invitedActor = caller === "unauthenticated" ? USERS.outsider : USERS[caller];
  const invitations = new D1InvitationRepo(bindings.DB);
  const pendingInvitation: WorkspaceInvitation = {
    id: INVITATION_ID,
    workspaceId: WORKSPACE.id,
    email: "pending@rbac.test",
    role: "MEMBER",
    tokenHash: await sha256Hex("rbac-pending-token"),
    invitedBy: USERS.owner.id,
    expiresAt: NOW + 86_400_000,
    acceptedAt: null,
    revokedAt: null,
    createdAt: NOW,
  };
  await invitations.insert(pendingInvitation);
  await invitations.insert({
    ...pendingInvitation,
    id: PUBLIC_INVITATION_ID,
    workspaceId: INVITE_WORKSPACE.id,
    email: invitedActor.email,
    tokenHash: await sha256Hex(PUBLIC_INVITATION_TOKEN),
    invitedBy: USERS.target.id,
  });

  const emailTokens = new D1EmailTokenRepo(bindings.DB);
  await emailTokens.insert({
    id: "et_rbac_verify",
    userId: USERS.auth.id,
    type: "VERIFY_EMAIL",
    tokenHash: await sha256Hex(VERIFY_TOKEN),
    expiresAt: NOW + 86_400_000,
    usedAt: null,
    createdAt: NOW,
  });
  await emailTokens.insert({
    id: "et_rbac_reset",
    userId: USERS.auth.id,
    type: "RESET_PASSWORD",
    tokenHash: await sha256Hex(RESET_TOKEN),
    expiresAt: NOW + 86_400_000,
    usedAt: null,
    createdAt: NOW,
  });
  await new D1RefreshTokenRepo(bindings.DB).insert({
    id: "rt_rbac_matrix",
    userId: USERS.owner.id,
    tokenHash: await sha256Hex(REFRESH_TOKEN),
    expiresAt: NOW + 86_400_000,
    revokedAt: null,
    replacedById: null,
    createdAt: NOW,
  });

  const encryptedChannel = await encryptSecret(
    JSON.stringify({ emails: ["ops@rbac.test"] }),
    config.encryptionKey,
  );
  const channel: NotificationChannel = {
    id: CHANNEL_ID,
    workspaceId: WORKSPACE.id,
    name: "Matrix email",
    type: "EMAIL",
    encryptedConfig: encryptedChannel,
    enabled: true,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: USERS.owner.id,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await new D1ChannelRepo(bindings.DB).insert(channel);
  const secret: WorkspaceSecret = {
    id: SECRET_ID,
    workspaceId: WORKSPACE.id,
    key: "MATRIX_TOKEN",
    encryptedValue: await encryptSecret("matrix-secret", config.encryptionKey),
    encryptionVersion: 1,
    allowedDomains: ["example.com"],
    description: "Matrix secret",
    createdBy: USERS.owner.id,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await new D1SecretRepo(bindings.DB).insert(secret);
  const apiKey: WorkspaceApiKey = {
    id: API_KEY_ID,
    workspaceId: WORKSPACE.id,
    name: "Matrix key",
    keyPrefix: "zgk_rbacmatr",
    keyHash: await sha256Hex("zgk_rbac-matrix-key"),
    createdBy: USERS.owner.id,
    createdAt: NOW,
    lastUsedAt: null,
    revokedAt: null,
  };
  await new D1ApiKeyRepo(bindings.DB).insert(apiKey);

  const browserTest: BrowserTest = {
    id: TEST_ID,
    workspaceId: WORKSPACE.id,
    name: BROWSER_CONFIG.name,
    startUrl: BROWSER_CONFIG.startUrl,
    instructions: BROWSER_CONFIG.instructions,
    device: BROWSER_CONFIG.device,
    intervalHours: BROWSER_CONFIG.intervalHours,
    maxRetries: BROWSER_CONFIG.maxRetries,
    notifyOnRecovery: BROWSER_CONFIG.notifyOnRecovery,
    nextRunAt: NOW + 86_400_000,
    createdBy: USERS.owner.id,
    updatedBy: USERS.owner.id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
  await new D1BrowserTestRepo(bindings.DB).insert(browserTest);
  const run: TestRun = {
    id: RUN_ID,
    workspaceId: WORKSPACE.id,
    browserTestId: TEST_ID,
    source: "MANUAL",
    status: "PASSED",
    snapshot: {
      ...BROWSER_CONFIG,
      channelIds: [],
      viewport: { width: 1440, height: 900 },
      modelName: "gpt-5-mini",
      runnerVersion: "rbac-matrix",
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
  await new D1RunRepo(bindings.DB).insert(run);
  const attempt: TestAttempt = {
    id: ATTEMPT_ID,
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
    runnerVersion: "rbac-matrix",
    runnerKind: null,
    systemErrorCode: null,
    createdAt: NOW - 2_000,
  };
  await new D1AttemptRepo(bindings.DB).insert(attempt);
  const artifacts = new D1ArtifactRepo(bindings.DB);
  const screenshot: RunArtifact = {
    id: SCREENSHOT_ID,
    workspaceId: WORKSPACE.id,
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    type: "SCREENSHOT",
    storageKey: "ws/ws_rbac_matrix/rbac.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 3,
    metadataJson: null,
    createdAt: NOW,
    expiresAt: NOW + 86_400_000,
  };
  const report: RunArtifact = {
    ...screenshot,
    id: REPORT_ID,
    attemptId: null,
    type: "MARKDOWN_REPORT",
    storageKey: "ws/ws_rbac_matrix/rbac-report.md",
    mimeType: "text/markdown",
    metadataJson: JSON.stringify({ filename: "rbac-report.md" }),
  };
  await artifacts.insert(screenshot);
  await artifacts.insert(report);
  await bindings.ARTIFACTS.put(screenshot.storageKey, new Uint8Array([1, 2, 3]));
  await bindings.ARTIFACTS.put(report.storageKey, "# RBAC report");

  const monitor: UptimeMonitor = {
    id: MONITOR_ID,
    workspaceId: WORKSPACE.id,
    name: MONITOR_CONFIG.name,
    url: MONITOR_CONFIG.url,
    method: MONITOR_CONFIG.method,
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: MONITOR_CONFIG.expectedStatus,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: MONITOR_CONFIG.frequencySeconds,
    timeoutSeconds: MONITOR_CONFIG.timeoutSeconds,
    maxRetries: MONITOR_CONFIG.maxRetries,
    notifyOnRecovery: MONITOR_CONFIG.notifyOnRecovery,
    nextCheckAt: NOW + 300_000,
    currentStatus: "UP",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: NOW,
    lastResponseTimeMs: 40,
    createdBy: USERS.owner.id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
  await new D1MonitorRepo(bindings.DB).insert(monitor);
  const check: UptimeCheck = {
    id: CHECK_ID,
    workspaceId: WORKSPACE.id,
    uptimeMonitorId: MONITOR_ID,
    cycleId: "cyc_rbac_matrix",
    attemptIndex: 0,
    status: "PASSED",
    httpStatus: 200,
    responseTimeMs: 40,
    failureReason: null,
    responseExcerpt: null,
    checkedAt: NOW,
    createdAt: NOW,
  };
  await new D1CheckRepo(bindings.DB).insertIfAbsent(check);
  const incident: Incident = {
    id: INCIDENT_ID,
    workspaceId: WORKSPACE.id,
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: MONITOR_ID,
    status: "OPEN",
    openedAt: NOW,
    resolvedAt: null,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: CHECK_ID,
    resolvedByCheckId: null,
    lastEventAt: NOW,
    createdAt: NOW,
  };
  await new D1IncidentRepo(bindings.DB).insertOpen(incident);
  const event: IncidentEvent = {
    id: "evt_rbac_matrix",
    incidentId: INCIDENT_ID,
    type: "OPENED",
    sourceId: CHECK_ID,
    message: "Monitor failed",
    metadataJson: null,
    createdAt: NOW,
  };
  await new D1IncidentEventRepo(bindings.DB).insert(event);

  const paddle = new RecordingPaddleClient();
  paddle.transactions = [
    {
      id: "txn_rbac_matrix",
      billedAt: new Date(NOW).toISOString(),
      status: "paid",
      totalCents: 3_900,
      currency: "EUR",
      invoiceNumber: "INV-RBAC",
    },
  ];
  paddle.invoiceUrl = "https://paddle.test/invoice.pdf";
  const ids = new FakeIds();
  const app = buildApp(bindings, {
    clock,
    ids,
    emailSender: new RecordingEmailSender(),
    paddleClient: paddle,
    billingCanceller: new RecordingBillingCanceller(),
    channelSender: {
      send: async () => ({ providerMessageId: "msg_rbac_matrix" }),
    },
    uptimeCheckExecutor: async () => ({
      status: "PASSED",
      httpStatus: 200,
      responseTimeMs: 25,
      failureReason: null,
      responseExcerpt: null,
      conditions: [
        { type: "status", passed: true, detail: "expected 200, got 200" },
      ],
    }),
    runQueue: {
      send: async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    },
  });
  const authorization: Partial<Record<Caller, string>> = {};
  for (const actor of ["owner", "admin", "member", "outsider"] as const) {
    authorization[actor] = `Bearer ${await issueAccessToken(
      config,
      { ...USERS[actor], passwordHash },
      clock,
    )}`;
  }
  return {
    app,
    authorization,
    invitationToken: PUBLIC_INVITATION_TOKEN,
    refreshToken: REFRESH_TOKEN,
    config,
  };
}

const route = (
  label: string,
  access: Access,
  success: number,
  path: string,
  init?: RequestInit,
  subscriptionRequired = false,
): RouteCase => ({
  label,
  access,
  success,
  ...(subscriptionRequired ? { subscription: true as const } : {}),
  request: async () => ({ path, ...(init === undefined ? {} : { init }) }),
});

const ROUTES: RouteCase[] = [
  route("GET /api/health", "P", 200, "/api/health"),
  route(
    "POST /api/auth/register",
    "P",
    201,
    "/api/auth/register",
    json("POST", {
      name: "New Matrix User",
      email: "new-user@rbac.test",
      password: PASSWORD,
    }),
  ),
  route(
    "POST /api/auth/verify-email",
    "P",
    200,
    "/api/auth/verify-email",
    json("POST", { token: VERIFY_TOKEN }),
  ),
  route(
    "POST /api/auth/resend-verification",
    "P",
    200,
    "/api/auth/resend-verification",
    json("POST", { email: "missing@rbac.test" }),
  ),
  route(
    "POST /api/auth/login",
    "P",
    200,
    "/api/auth/login",
    json("POST", { email: USERS.owner.email, password: PASSWORD }),
  ),
  {
    label: "POST /api/auth/refresh",
    access: "P",
    success: 200,
    request: async (fixture) => ({
      path: "/api/auth/refresh",
      init: { method: "POST", headers: { Cookie: `zenguy_rt=${fixture.refreshToken}` } },
    }),
  },
  {
    label: "POST /api/auth/logout",
    access: "P",
    success: 204,
    request: async (fixture) => ({
      path: "/api/auth/logout",
      init: { method: "POST", headers: { Cookie: `zenguy_rt=${fixture.refreshToken}` } },
    }),
  },
  route(
    "POST /api/auth/forgot-password",
    "P",
    200,
    "/api/auth/forgot-password",
    json("POST", { email: "missing@rbac.test" }),
  ),
  route(
    "POST /api/auth/reset-password",
    "P",
    200,
    "/api/auth/reset-password",
    json("POST", { token: RESET_TOKEN, password: "replacement-password" }),
  ),
  route("GET /api/auth/me", "A", 200, "/api/auth/me"),
  {
    label: "GET /api/invitations/:token",
    access: "P",
    success: 200,
    request: async (fixture) => ({
      path: `/api/invitations/${fixture.invitationToken}`,
    }),
  },
  {
    label: "POST /api/invitations/:token/accept",
    access: "A",
    success: 200,
    request: async (fixture) => ({
      path: `/api/invitations/${fixture.invitationToken}/accept`,
      init: json("POST", {}),
    }),
  },
  route("GET /api/billing/config", "A", 200, "/api/billing/config"),
  route("GET /api/me/push-devices", "A", 200, "/api/me/push-devices"),
  route(
    "PUT /api/me/push-devices",
    "A",
    200,
    "/api/me/push-devices",
    json("PUT", {
      token: "ExponentPushToken[rbacmatrix000000000000]",
      platform: "ios",
      deviceName: "Matrix iPhone",
    }),
  ),
  {
    label: "POST /api/webhooks/paddle",
    access: "P",
    success: 200,
    request: async (fixture, caller) => {
      const rawBody = JSON.stringify({
        event_id: `evt_rbac_${caller}`,
        event_type: "transaction.completed",
        occurred_at: new Date(NOW).toISOString(),
        data: {},
      });
      const timestamp = Math.floor(NOW / 1_000);
      const signature = await hmacSha256Hex(
        fixture.config.paddle!.webhookSecret,
        `${timestamp}:${rawBody}`,
      );
      return {
        path: "/api/webhooks/paddle",
        init: {
          method: "POST",
          headers: { "Paddle-Signature": `ts=${timestamp};h1=${signature}` },
          body: rawBody,
        },
      };
    },
  },
  {
    label: "GET /api/artifact-content",
    access: "P",
    success: 200,
    request: async (fixture) => ({
      path: await signArtifactUrl(fixture.config, SCREENSHOT_ID, NOW),
    }),
  },
  route(
    "POST /api/workspaces",
    "A",
    201,
    "/api/workspaces",
    json("POST", { name: "Created by matrix", timezone: "UTC" }),
  ),
  route("GET /api/workspaces", "A", 200, "/api/workspaces"),
  route("GET /api/workspaces/:id", "M", 200, `/api/workspaces/${WORKSPACE.id}`),
  route(
    "PATCH /api/workspaces/:id",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}`,
    json("PATCH", { timezone: "Europe/Madrid" }),
  ),
  route(
    "DELETE /api/workspaces/:id",
    "OWNER",
    204,
    `/api/workspaces/${WORKSPACE.id}`,
    json("DELETE", { confirmName: WORKSPACE.name }),
  ),
  route(
    "POST /api/workspaces/:id/transfer-ownership",
    "OWNER",
    200,
    `/api/workspaces/${WORKSPACE.id}/transfer-ownership`,
    json("POST", { newOwnerUserId: USERS.target.id }),
  ),
  route("GET .../members", "M", 200, `/api/workspaces/${WORKSPACE.id}/members`),
  route(
    "PATCH .../members/:userId",
    "OWNER",
    200,
    `/api/workspaces/${WORKSPACE.id}/members/${USERS.target.id}`,
    json("PATCH", { role: "ADMIN" }),
  ),
  route(
    "DELETE .../members/:userId",
    "OWNER_ADMIN",
    204,
    `/api/workspaces/${WORKSPACE.id}/members/${USERS.target.id}`,
    { method: "DELETE" },
  ),
  route("GET .../invitations", "OWNER_ADMIN", 200, `/api/workspaces/${WORKSPACE.id}/invitations`),
  route(
    "POST .../invitations",
    "OWNER_ADMIN",
    201,
    `/api/workspaces/${WORKSPACE.id}/invitations`,
    json("POST", { email: "fresh-invite@rbac.test", role: "MEMBER" }),
  ),
  route(
    "DELETE .../invitations/:invitationId",
    "OWNER_ADMIN",
    204,
    `/api/workspaces/${WORKSPACE.id}/invitations/${INVITATION_ID}`,
    { method: "DELETE" },
  ),
  route("GET .../billing", "OWNER_ADMIN", 200, `/api/workspaces/${WORKSPACE.id}/billing`),
  route(
    "GET .../billing/invoices/:txId/url",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/billing/invoices/txn_rbac_matrix/url`,
  ),
  route("GET .../secrets", "M", 200, `/api/workspaces/${WORKSPACE.id}/secrets`),
  route(
    "POST .../secrets",
    "OWNER_ADMIN",
    201,
    `/api/workspaces/${WORKSPACE.id}/secrets`,
    json("POST", {
      key: "NEW_MATRIX_TOKEN",
      value: "new-matrix-secret",
      allowedDomains: ["example.com"],
      description: "Created by matrix",
    }),
    true,
  ),
  route(
    "PUT .../secrets/:secretId",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/secrets/${SECRET_ID}`,
    json("PUT", { description: "Updated by matrix" }),
    true,
  ),
  route(
    "DELETE .../secrets/:secretId",
    "OWNER_ADMIN",
    204,
    `/api/workspaces/${WORKSPACE.id}/secrets/${SECRET_ID}`,
    { method: "DELETE" },
    true,
  ),
  route(
    "GET .../api-keys",
    "M",
    200,
    `/api/workspaces/${WORKSPACE.id}/api-keys`,
  ),
  route(
    "POST .../api-keys",
    "OWNER_ADMIN",
    201,
    `/api/workspaces/${WORKSPACE.id}/api-keys`,
    json("POST", { name: "Created by matrix" }),
    true,
  ),
  route(
    "DELETE .../api-keys/:apiKeyId",
    "OWNER_ADMIN",
    204,
    `/api/workspaces/${WORKSPACE.id}/api-keys/${API_KEY_ID}`,
    { method: "DELETE" },
  ),
  route("GET .../channels", "M", 200, `/api/workspaces/${WORKSPACE.id}/channels`),
  route(
    "GET .../channels/:id/deliveries",
    "M",
    200,
    `/api/workspaces/${WORKSPACE.id}/channels/${CHANNEL_ID}/deliveries`,
  ),
  route(
    "POST .../channels",
    "OWNER_ADMIN",
    201,
    `/api/workspaces/${WORKSPACE.id}/channels`,
    json("POST", {
      name: "New matrix email",
      type: "EMAIL",
      config: { emails: ["new@rbac.test"] },
    }),
    true,
  ),
  route(
    "PATCH .../channels/:id",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/channels/${CHANNEL_ID}`,
    json("PATCH", { name: "Updated matrix email" }),
    true,
  ),
  route(
    "DELETE .../channels/:id",
    "OWNER_ADMIN",
    204,
    `/api/workspaces/${WORKSPACE.id}/channels/${CHANNEL_ID}`,
    { method: "DELETE" },
    true,
  ),
  route(
    "POST .../channels/:id/test",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/channels/${CHANNEL_ID}/test`,
    { method: "POST" },
    true,
  ),
  route("GET .../alerts", "M", 200, `/api/workspaces/${WORKSPACE.id}/alerts`),
  route(
    "GET .../alerts/quote",
    "M",
    200,
    `/api/workspaces/${WORKSPACE.id}/alerts/quote?phoneNumber=%2B34600123456`,
  ),
  route(
    "PATCH .../alerts/settings",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/alerts/settings`,
    json("PATCH", { dailyPaidAlertLimit: 10 }),
  ),
  route(
    "GET .../alerts/credit/entries",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/alerts/credit/entries`,
  ),
  route(
    "POST .../alerts/credit/topups",
    "OWNER",
    201,
    `/api/workspaces/${WORKSPACE.id}/alerts/credit/topups`,
    json("POST", { packs: 1 }),
  ),
  route("GET .../browser-tests", "M", 200, `/api/workspaces/${WORKSPACE.id}/browser-tests`),
  route("GET .../browser-tests/:id", "M", 200, `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST_ID}`),
  route("GET .../browser-tests/:id/runs", "M", 200, `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST_ID}/runs`),
  route(
    "POST .../browser-tests",
    "OWNER_ADMIN",
    201,
    `/api/workspaces/${WORKSPACE.id}/browser-tests`,
    json("POST", { ...BROWSER_CONFIG, name: "New matrix browser test" }),
    true,
  ),
  route(
    "PATCH .../browser-tests/:id",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST_ID}`,
    json("PATCH", { name: "Updated matrix browser test" }),
    true,
  ),
  route(
    "DELETE .../browser-tests/:id",
    "OWNER_ADMIN",
    204,
    `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST_ID}`,
    { method: "DELETE" },
    true,
  ),
  route(
    "POST .../browser-tests/validate",
    "OWNER_ADMIN",
    202,
    `/api/workspaces/${WORKSPACE.id}/browser-tests/validate`,
    json("POST", BROWSER_CONFIG),
    true,
  ),
  route(
    "POST .../browser-tests/:id/run-now",
    "OWNER_ADMIN",
    202,
    `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST_ID}/run-now`,
    { method: "POST" },
    true,
  ),
  route(
    "GET .../browser-tests/export",
    "M",
    200,
    `/api/workspaces/${WORKSPACE.id}/browser-tests/export`,
  ),
  route(
    "POST .../browser-tests/import",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/browser-tests/import`,
    json("POST", {
      version: 1,
      tests: [{ ...BROWSER_CONFIG, name: "Imported matrix browser test" }],
    }),
    true,
  ),
  route("GET .../runs/:runId", "M", 200, `/api/workspaces/${WORKSPACE.id}/runs/${RUN_ID}`),
  route("GET .../runs/:runId/report", "M", 200, `/api/workspaces/${WORKSPACE.id}/runs/${RUN_ID}/report`),
  {
    label: "GET .../runs/:runId/events",
    access: "P",
    success: 200,
    request: async (fixture) => {
      const exp = Math.floor(NOW / 1_000) + 600;
      const sig = await hmacSign(
        fixture.config.artifactUrlSecret,
        `sse.${RUN_ID}.${exp}`,
      );
      return {
        path: `/api/workspaces/${WORKSPACE.id}/runs/${RUN_ID}/events?exp=${exp}&sig=${encodeURIComponent(sig)}`,
      };
    },
  },
  route("GET .../attempts/:attemptId", "M", 200, `/api/workspaces/${WORKSPACE.id}/attempts/${ATTEMPT_ID}`),
  route("GET .../uptime-monitors", "M", 200, `/api/workspaces/${WORKSPACE.id}/uptime-monitors`),
  route("GET .../uptime-monitors/:id", "M", 200, `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${MONITOR_ID}`),
  route("GET .../uptime-monitors/:id/checks", "M", 200, `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${MONITOR_ID}/checks`),
  route("GET .../uptime-monitors/:id/stats", "M", 200, `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${MONITOR_ID}/stats`),
  route(
    "POST .../uptime-monitors",
    "OWNER_ADMIN",
    201,
    `/api/workspaces/${WORKSPACE.id}/uptime-monitors`,
    json("POST", { ...MONITOR_CONFIG, name: "New matrix monitor" }),
    true,
  ),
  route(
    "PATCH .../uptime-monitors/:id",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${MONITOR_ID}`,
    json("PATCH", { name: "Updated matrix monitor" }),
    true,
  ),
  route(
    "DELETE .../uptime-monitors/:id",
    "OWNER_ADMIN",
    204,
    `/api/workspaces/${WORKSPACE.id}/uptime-monitors/${MONITOR_ID}`,
    { method: "DELETE" },
    true,
  ),
  route(
    "POST .../uptime-monitors/test-request",
    "OWNER_ADMIN",
    200,
    `/api/workspaces/${WORKSPACE.id}/uptime-monitors/test-request`,
    json("POST", MONITOR_CONFIG),
    true,
  ),
  route("GET .../incidents", "M", 200, `/api/workspaces/${WORKSPACE.id}/incidents`),
  route("GET .../incidents/:id", "M", 200, `/api/workspaces/${WORKSPACE.id}/incidents/${INCIDENT_ID}`),
  route("GET .../overview", "M", 200, `/api/workspaces/${WORKSPACE.id}/overview`),
  route("GET .../audit-logs", "OWNER_ADMIN", 200, `/api/workspaces/${WORKSPACE.id}/audit-logs`),
];

const CALLERS: Caller[] = [
  "owner",
  "admin",
  "member",
  "outsider",
  "unauthenticated",
];

describe("Appendix C RBAC matrix", () => {
  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  it.each(ROUTES)("$label", async (currentRoute) => {
    for (const caller of CALLERS) {
      const fixture = await seedFixture(caller);
      const request = await currentRoute.request(fixture, caller);
      const headers = new Headers(request.init?.headers);
      const authorization = fixture.authorization[caller];
      if (authorization !== undefined) headers.set("Authorization", authorization);
      const response = await fixture.app.request(request.path, {
        ...request.init,
        headers,
      });
      const expected = expectedStatus(currentRoute, caller);
      const detail =
        response.status === expected ? "" : `: ${await response.text()}`;
      expect(
        response.status,
        `${currentRoute.label} as ${caller}${detail}`,
      ).toBe(expected);
      if (response.body !== null) await response.body.cancel();
    }
  });

  it("returns 402 at every subscription-gated route", async () => {
    for (const currentRoute of ROUTES.filter(
      (candidate) => candidate.subscription === true,
    )) {
      const fixture = await seedFixture("owner", false);
      const request = await currentRoute.request(fixture, "owner");
      const headers = new Headers(request.init?.headers);
      headers.set("Authorization", fixture.authorization.owner ?? "");
      const response = await fixture.app.request(request.path, {
        ...request.init,
        headers,
      });
      const detail = response.status === 402 ? "" : `: ${await response.text()}`;
      expect(response.status, `${currentRoute.label}${detail}`).toBe(402);
      if (response.body !== null) await response.body.cancel();
    }
  });
});
