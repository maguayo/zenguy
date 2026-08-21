import type { Hono } from "hono";
import { buildApp } from "../../app";
import { defaultAlertSettings } from "../../domain/alerts/types";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AlertRepo } from "../../infrastructure/db/alert_repo";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig, type Bindings } from "../../shared/config";
import { encryptSecret } from "../../shared/crypto";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_alerts_owner",
    name: "Owner",
    email: "owner@alerts.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  admin: {
    id: "usr_alerts_admin",
    name: "Admin",
    email: "admin@alerts.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  member: {
    id: "usr_alerts_member",
    name: "Member",
    email: "member@alerts.test",
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
  id: "ws_alerts",
  name: "Alerts Workspace",
  slug: "alerts-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_alerts",
  workspaceId: WORKSPACE.id,
  provider: "internal",
  source: "free",
  providerCustomerId: null,
  providerSubscriptionId: null,
  status: "ACTIVE",
  periodStart: null,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("alert routes", () => {
  let bindings: Bindings;
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;
  let alerts: D1AlertRepo;
  let channels: D1ChannelRepo;
  let audits: D1AuditRepo;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_alerts_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: sequence,
      });
    }
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    alerts = new D1AlertRepo(bindings.DB);
    channels = new D1ChannelRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    const config = loadConfig(bindings);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, systemClock)}`,
    };
    app = buildApp(bindings);
  });

  function headers(actor: Actor): HeadersInit {
    return { Authorization: tokens[actor], "content-type": "application/json" };
  }

  const base = () => `/api/workspaces/${WORKSPACE.id}/alerts`;

  it("serves the overview with pricing, hiding credit from members", async () => {
    await alerts.credit({
      id: "ace_seed",
      workspaceId: WORKSPACE.id,
      amountCents: 500,
      kind: "GRANT",
      idempotencyKey: "grant:seed",
      description: "Seed",
      deliveryId: null,
      providerTransactionId: null,
      at: 1,
    });
    const owner = await app.request(base(), { headers: headers("owner") });
    expect(owner.status).toBe(200);
    const body = (await owner.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      settings: { paidChannelsEnabled: false, dailyPaidAlertLimit: 20 },
      status: { paidChannelCount: 0, paidAlertsPaused: true, pauseReason: "PAID_OFF" },
      credit: { balanceCents: 500, currency: "EUR", paidAlertsLast24h: 0 },
      topUp: { available: true, packCents: 1_000, minPacks: 1, maxPacks: 10 },
      destinations: [],
    });
    const pricing = body.data.pricing as {
      regions: { key: string; countries: { iso: string; smsCents: number }[] }[];
    };
    expect(pricing.regions.map((region) => region.key)).toEqual(["US_CA", "EUROPE", "ROW"]);
    expect(
      pricing.regions[1]?.countries.find((country) => country.iso === "ES"),
    ).toMatchObject({ smsCents: 18 });

    const member = await app.request(base(), { headers: headers("member") });
    expect(member.status).toBe(200);
    await expect(member.json()).resolves.toMatchObject({
      data: { credit: null, topUp: { available: true } },
    });
  });

  it("quotes prices per destination for any member", async () => {
    const response = await app.request(
      `${base()}/quote?phoneNumber=%2B34600123456`,
      { headers: headers("member") },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        destination: { iso: "ES", name: "Spain", region: "EUROPE" },
        smsCents: 18,
        callCents: 20,
        currency: "EUR",
      },
    });
    const invalid = await app.request(`${base()}/quote?phoneNumber=600123456`, {
      headers: headers("member"),
    });
    expect(invalid.status).toBe(400);
  });

  it("lets admins change settings, audits it, and forbids members", async () => {
    const forbidden = await app.request(`${base()}/settings`, {
      method: "PATCH",
      headers: headers("member"),
      body: JSON.stringify({ paidChannelsEnabled: true }),
    });
    expect(forbidden.status).toBe(403);

    const updated = await app.request(`${base()}/settings`, {
      method: "PATCH",
      headers: headers("admin"),
      body: JSON.stringify({ paidChannelsEnabled: true, dailyPaidAlertLimit: 5 }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: { paidChannelsEnabled: true, dailyPaidAlertLimit: 5 },
    });
    await expect(alerts.findSettings(WORKSPACE.id)).resolves.toMatchObject({
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 5,
    });
    const entries = await audits.list(WORKSPACE.id, null, 10);
    expect(entries.map((entry) => entry.action)).toEqual(["alerts.settings_updated"]);

    const invalid = await app.request(`${base()}/settings`, {
      method: "PATCH",
      headers: headers("owner"),
      body: JSON.stringify({ dailyPaidAlertLimit: 999 }),
    });
    expect(invalid.status).toBe(400);
    const empty = await app.request(`${base()}/settings`, {
      method: "PATCH",
      headers: headers("owner"),
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });

  it("pages the credit ledger for billing viewers only", async () => {
    for (const index of [1, 2, 3]) {
      await alerts.credit({
        id: `ace_${index}`,
        workspaceId: WORKSPACE.id,
        amountCents: 100,
        kind: "GRANT",
        idempotencyKey: `grant:${index}`,
        description: `Grant ${index}`,
        deliveryId: null,
        providerTransactionId: null,
        at: index * 1_000,
      });
    }
    const first = await app.request(`${base()}/credit/entries?limit=2`, {
      headers: headers("admin"),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: { id: string; amountCents: number; balanceAfterCents: number; createdAt: string }[];
      nextCursor: string | null;
    };
    expect(firstBody.data.map((entry) => entry.id)).toEqual(["ace_3", "ace_2"]);
    expect(firstBody.data[0]).toMatchObject({
      amountCents: 100,
      balanceAfterCents: 300,
      createdAt: new Date(3_000).toISOString(),
    });
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await app.request(
      `${base()}/credit/entries?limit=2&cursor=${firstBody.nextCursor}`,
      { headers: headers("admin") },
    );
    const secondBody = (await second.json()) as {
      data: { id: string }[];
      nextCursor: string | null;
    };
    expect(secondBody.data.map((entry) => entry.id)).toEqual(["ace_1"]);
    expect(secondBody.nextCursor).toBeNull();

    const member = await app.request(`${base()}/credit/entries`, {
      headers: headers("member"),
    });
    expect(member.status).toBe(403);
  });

  it("starts a top-up for the owner and is unavailable without a Paddle price", async () => {
    const admin = await app.request(`${base()}/credit/topups`, {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({ packs: 2 }),
    });
    expect(admin.status).toBe(403);

    const owner = await app.request(`${base()}/credit/topups`, {
      method: "POST",
      headers: headers("owner"),
      body: JSON.stringify({ packs: 2 }),
    });
    expect(owner.status).toBe(201);
    await expect(owner.json()).resolves.toEqual({
      data: {
        priceId: bindings.PADDLE_ALERT_CREDIT_PRICE_ID,
        quantity: 2,
        amountCents: 2_000,
        customData: { workspace_id: WORKSPACE.id, purpose: "alert_credit" },
      },
    });

    const freeBindings = { ...bindings };
    delete freeBindings.PADDLE_ALERT_CREDIT_PRICE_ID;
    const freeApp = buildApp(freeBindings);
    const unavailable = await freeApp.request(`${base()}/credit/topups`, {
      method: "POST",
      headers: headers("owner"),
      body: JSON.stringify({ packs: 1 }),
    });
    expect(unavailable.status).toBe(503);
    const overview = await freeApp.request(base(), { headers: headers("owner") });
    await expect(overview.json()).resolves.toMatchObject({
      data: { topUp: { available: false } },
    });
    const enable = await freeApp.request(`${base()}/settings`, {
      method: "PATCH",
      headers: headers("owner"),
      body: JSON.stringify({ paidChannelsEnabled: true }),
    });
    expect(enable.status).toBe(400);
    await expect(enable.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: [{ field: "paidChannelsEnabled" }],
      },
    });
  });

  it("counts configured paid destinations and reports a no-credit pause", async () => {
    await alerts.insertSettings({
      ...defaultAlertSettings(WORKSPACE.id, 1),
      paidChannelsEnabled: true,
    });
    const config = loadConfig(bindings);
    await channels.insert({
      id: "ch_alerts_sms",
      workspaceId: WORKSPACE.id,
      name: "On-call",
      type: "SMS",
      encryptedConfig: await encryptSecret(
        JSON.stringify({ phoneNumber: "+34600123456", consent: true }),
        config.encryptionKey,
      ),
      enabled: true,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: USERS.owner.id,
      createdAt: 1,
      updatedAt: 1,
    });
    const response = await app.request(base(), { headers: headers("owner") });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: { paidChannelCount: 1, paidAlertsPaused: true, pauseReason: "NO_CREDIT" },
        destinations: [{ iso: "ES", name: "Spain", channels: 1 }],
      },
    });
  });
});
