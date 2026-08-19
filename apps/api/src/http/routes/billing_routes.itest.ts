import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription, UsageEvent } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UsageEventRepo } from "../../infrastructure/db/usage_event_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { RecordingPaddleClient } from "../../test/fakes/billing";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";
const PERIOD_START = Date.parse("2026-08-01T00:00:00Z");
const PERIOD_END = Date.parse("2026-09-01T00:00:00Z");
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_billing_owner",
    name: "Owner",
    email: "owner@billing.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  admin: {
    id: "usr_billing_admin",
    name: "Admin",
    email: "admin@billing.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  member: {
    id: "usr_billing_member",
    name: "Member",
    email: "member@billing.test",
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
  id: "ws_billing",
  name: "Billing Workspace",
  slug: "billing-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_billing",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_billing",
  providerSubscriptionId: "sub_provider_billing",
  status: "ACTIVE",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: "https://paddle.test/update",
  cancelUrl: "https://paddle.test/cancel",
  createdAt: PERIOD_START,
  updatedAt: PERIOD_START,
};
const USAGE: UsageEvent = {
  id: "ue_billing",
  workspaceId: WORKSPACE.id,
  testRunId: "run_billing",
  type: "BROWSER_RUN",
  quantity: 301,
  billable: true,
  idempotencyKey: "run:run_billing",
  occurredAt: PERIOD_START,
  reversedAt: null,
  createdAt: PERIOD_START,
};

describe("billing routes", () => {
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;
  let paddle: RecordingPaddleClient;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_billing_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: sequence,
      });
    }
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    await new D1UsageEventRepo(bindings.DB).insertIfAbsent(USAGE);
    const config = loadConfig(bindings);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, systemClock)}`,
    };
    paddle = new RecordingPaddleClient();
    paddle.transactions = [
      {
        id: "txn_billing",
        billedAt: "2026-08-02T00:00:00Z",
        status: "paid",
        totalCents: 3900,
        currency: "EUR",
        invoiceNumber: "INV-BILLING",
      },
    ];
    paddle.invoiceUrl = "https://paddle.test/invoice.pdf";
    app = buildApp(bindings, { paddleClient: paddle });
  });

  function headers(actor: Actor): HeadersInit {
    return { Authorization: tokens[actor] };
  }

  it("serves authenticated Paddle client config and real workspace status", async () => {
    const unauthorized = await app.request("/api/billing/config");
    expect(unauthorized.status).toBe(401);

    const config = await app.request("/api/billing/config", {
      headers: headers("owner"),
    });
    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toEqual({
      data: {
        environment: "sandbox",
        clientToken: "test-paddle-client-token",
        priceId: "pri_test_monthly",
      },
    });

    const workspaces = await app.request("/api/workspaces", {
      headers: headers("owner"),
    });
    await expect(workspaces.json()).resolves.toMatchObject({
      data: [{ id: WORKSPACE.id, subscriptionStatus: "ACTIVE" }],
    });
    const workspace = await app.request(`/api/workspaces/${WORKSPACE.id}`, {
      headers: headers("owner"),
    });
    await expect(workspace.json()).resolves.toMatchObject({
      data: { id: WORKSPACE.id, subscriptionStatus: "ACTIVE" },
    });

    const updated = await app.request(`/api/workspaces/${WORKSPACE.id}`, {
      method: "PATCH",
      headers: {
        ...headers("owner"),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Billing Workspace Updated" }),
    });
    await expect(updated.json()).resolves.toMatchObject({
      data: { name: "Billing Workspace Updated", subscriptionStatus: "ACTIVE" },
    });
  });

  it("rejects members, hides admin management URLs, and shows owner data", async () => {
    const member = await app.request(
      `/api/workspaces/${WORKSPACE.id}/billing`,
      { headers: headers("member") },
    );
    expect(member.status).toBe(403);

    const admin = await app.request(
      `/api/workspaces/${WORKSPACE.id}/billing`,
      { headers: headers("admin") },
    );
    expect(admin.status).toBe(200);
    await expect(admin.json()).resolves.toMatchObject({
      data: {
        subscription: {
          updatePaymentMethodUrl: null,
          cancelUrl: null,
        },
      },
    });

    const owner = await app.request(
      `/api/workspaces/${WORKSPACE.id}/billing`,
      { headers: headers("owner") },
    );
    expect(owner.status).toBe(200);
    await expect(owner.json()).resolves.toEqual({
      data: {
        plan: {
          pricePerMonthCents: 3900,
          currency: "EUR",
          includedRuns: 300,
          overagePerRunCents: 20,
        },
        subscription: {
          status: "ACTIVE",
          periodStart: "2026-08-01T00:00:00.000Z",
          periodEnd: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          updatePaymentMethodUrl: "https://paddle.test/update",
          cancelUrl: "https://paddle.test/cancel",
        },
        usage: {
          periodStart: "2026-08-01T00:00:00.000Z",
          periodEnd: "2026-09-01T00:00:00.000Z",
          billableRuns: 301,
          includedRuns: 300,
          remainingRuns: 0,
          overageRuns: 1,
          overageAmountCents: 20,
          projectedTotalCents: 3920,
        },
        invoices: paddle.transactions,
      },
    });
  });

  it("returns an invoice URL only for a listed workspace transaction", async () => {
    const found = await app.request(
      `/api/workspaces/${WORKSPACE.id}/billing/invoices/txn_billing/url`,
      { headers: headers("admin") },
    );
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({
      data: { url: "https://paddle.test/invoice.pdf" },
    });

    const missing = await app.request(
      `/api/workspaces/${WORKSPACE.id}/billing/invoices/txn_other/url`,
      { headers: headers("owner") },
    );
    expect(missing.status).toBe(404);
    expect(paddle.invoiceRequests).toEqual(["txn_billing"]);
  });
});
