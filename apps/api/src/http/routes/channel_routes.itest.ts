import type { Hono } from "hono";
import { buildApp } from "../../app";
import type {
  ChannelSender,
  NotificationMessage,
} from "../../domain/channels/notifier";
import type { ChannelType } from "../../domain/channels/types";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { defaultAlertSettings } from "../../domain/alerts/types";
import { D1AlertRepo } from "../../infrastructure/db/alert_repo";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1DeliveryRepo } from "../../infrastructure/db/delivery_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { decryptSecret } from "../../shared/crypto";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";
const WEBHOOK_URL =
  "https://hooks.slack.com/services/T000/B000/first-private-token";
const REPLACEMENT_WEBHOOK_URL =
  "https://hooks.slack.com/services/T000/B000/replacement-secret";
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_channels_owner",
    name: "Owner",
    email: "owner@channels.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  admin: {
    id: "usr_channels_admin",
    name: "Admin",
    email: "admin@channels.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  member: {
    id: "usr_channels_member",
    name: "Member",
    email: "member@channels.test",
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
  id: "ws_channels",
  name: "Channel Workspace",
  slug: "channel-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_channels",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_channels",
  providerSubscriptionId: "sub_provider_channels",
  status: "ACTIVE",
  periodStart: 1,
  periodEnd: 9_999_999_999_999,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

interface SenderCall {
  channel: { type: ChannelType; config: unknown };
  message: NotificationMessage;
}

class RecordingChannelSender implements ChannelSender {
  readonly calls: SenderCall[] = [];
  failure: Error | null = null;

  async send(
    channel: { type: ChannelType; config: unknown },
    message: NotificationMessage,
  ): Promise<{ providerMessageId: string | null }> {
    this.calls.push({ channel, message });
    if (this.failure !== null) throw this.failure;
    return { providerMessageId: `provider-${this.calls.length}` };
  }
}

describe("channel routes", () => {
  let app: Hono<AppEnv>;
  let sender: RecordingChannelSender;
  let tokens: Record<Actor, string>;
  let channels: D1ChannelRepo;
  let deliveries: D1DeliveryRepo;
  let subscriptions: D1SubscriptionRepo;
  let audits: D1AuditRepo;
  let alerts: D1AlertRepo;
  let encryptionKey: Uint8Array;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
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
        id: `mem_channels_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: sequence,
      });
    }
    subscriptions = new D1SubscriptionRepo(bindings.DB);
    await subscriptions.upsertByWorkspace(SUBSCRIPTION);
    channels = new D1ChannelRepo(bindings.DB);
    deliveries = new D1DeliveryRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    alerts = new D1AlertRepo(bindings.DB);
    const config = loadConfig(bindings);
    encryptionKey = config.encryptionKey;
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, systemClock)}`,
    };
    sender = new RecordingChannelSender();
    app = buildApp(bindings, { channelSender: sender });
  });

  function headers(actor: Actor): HeadersInit {
    return {
      Authorization: tokens[actor],
      "content-type": "application/json",
    };
  }

  async function createChannel(
    type: ChannelType = "EMAIL",
    config: unknown = { emails: ["ops@example.com"] },
    actor: Actor = "owner",
  ): Promise<{ id: string; responseText: string }> {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels`,
      {
        method: "POST",
        headers: headers(actor),
        body: JSON.stringify({ name: `${type} alerts`, type, config }),
      },
    );
    const responseText = await response.text();
    expect(response.status).toBe(201);
    return {
      id: (JSON.parse(responseText) as { data: { id: string } }).data.id,
      responseText,
    };
  }

  it("creates, lists, updates, and deletes with encrypted config and safe previews", async () => {
    const created = await createChannel("SLACK", { webhookUrl: WEBHOOK_URL });
    expect(created.responseText).not.toContain(WEBHOOK_URL);
    expect(JSON.parse(created.responseText)).toMatchObject({
      data: {
        name: "SLACK alerts",
        type: "SLACK",
        enabled: true,
        configPreview: {
          webhookUrlMasked: "https://hooks.slack.com/…oken",
        },
        verifiedAt: null,
        lastDeliveryStatus: null,
      },
    });
    const stored = await channels.findById(WORKSPACE.id, created.id);
    expect(stored?.encryptedConfig).not.toContain(WEBHOOK_URL);
    await expect(
      decryptSecret(stored?.encryptedConfig ?? "", encryptionKey),
    ).resolves.toBe(JSON.stringify({ webhookUrl: WEBHOOK_URL }));

    const listed = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels`,
      { headers: headers("member") },
    );
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(WEBHOOK_URL);
    expect(JSON.parse(listedText)).toMatchObject({
      data: [{ id: created.id, configPreview: { webhookUrlMasked: expect.any(String) } }],
    });

    const updated = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}`,
      {
        method: "PATCH",
        headers: headers("admin"),
        body: JSON.stringify({
          name: "Primary Slack",
          enabled: false,
          config: { webhookUrl: REPLACEMENT_WEBHOOK_URL },
        }),
      },
    );
    const updatedText = await updated.text();
    expect(updated.status).toBe(200);
    expect(updatedText).not.toContain(WEBHOOK_URL);
    expect(updatedText).not.toContain(REPLACEMENT_WEBHOOK_URL);
    expect(JSON.parse(updatedText)).toMatchObject({
      data: { name: "Primary Slack", enabled: false },
    });
    const replaced = await channels.findById(WORKSPACE.id, created.id);
    await expect(
      decryptSecret(replaced?.encryptedConfig ?? "", encryptionKey),
    ).resolves.toBe(
      JSON.stringify({ webhookUrl: REPLACEMENT_WEBHOOK_URL }),
    );

    const deleted = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}`,
      { method: "DELETE", headers: headers("owner") },
    );
    expect(deleted.status).toBe(204);
    await expect(channels.findById(WORKSPACE.id, created.id)).resolves.toBeNull();

    const auditEntries = await audits.list(WORKSPACE.id, null, 10);
    expect(auditEntries.map(({ action }) => action)).toEqual([
      "channel.deleted",
      "channel.updated",
      "channel.created",
    ]);
    const auditJson = JSON.stringify(auditEntries);
    expect(auditJson).not.toContain(WEBHOOK_URL);
    expect(auditJson).not.toContain(REPLACEMENT_WEBHOOK_URL);
  });

  it("validates configuration for every channel type", async () => {
    const invalid: [ChannelType, unknown][] = [
      ["EMAIL", { emails: ["not-an-email"] }],
      ["SMS", { phoneNumber: "600123456", consent: true }],
      ["SMS", { phoneNumber: "+34600123456" }],
      ["WHATSAPP", { phoneNumber: "+01234567" }],
      ["CALL", { phoneNumber: "+123" }],
      ["SLACK", { webhookUrl: "https://example.com/not-slack" }],
      [
        "DISCORD",
        { webhookUrl: "https://hooks.slack.com/services/not-discord" },
      ],
      ["PUSH", { recipients: "OWNER_ONLY" }],
    ];
    for (const [type, config] of invalid) {
      const response = await app.request(
        `/api/workspaces/${WORKSPACE.id}/channels`,
        {
          method: "POST",
          headers: headers("owner"),
          body: JSON.stringify({ name: type, type, config }),
        },
      );
      expect(response.status, type).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }

    await alerts.insertSettings({
      ...defaultAlertSettings(WORKSPACE.id, 1),
      paidChannelsEnabled: true,
    });
    const valid: [ChannelType, unknown][] = [
      ["EMAIL", { emails: ["ops@example.com"] }],
      ["SMS", { phoneNumber: "+34600123456", consent: true }],
      ["WHATSAPP", { phoneNumber: "+34600123456" }],
      ["CALL", { phoneNumber: "+34600123456" }],
      [
        "SLACK",
        { webhookUrl: "https://hooks.slack.com/services/T/B/token" },
      ],
      [
        "DISCORD",
        { webhookUrl: "https://discord.com/api/webhooks/123/token" },
      ],
      ["PUSH", { recipients: "WORKSPACE_MEMBERS" }],
    ];
    for (const [type, config] of valid) {
      await createChannel(type, config);
    }

    const secondPush = await app.request(`/api/workspaces/${WORKSPACE.id}/channels`, {
      method: "POST",
      headers: headers("owner"),
      body: JSON.stringify({
        name: "Another push",
        type: "PUSH",
        config: { recipients: "WORKSPACE_MEMBERS" },
      }),
    });
    expect(secondPush.status).toBe(400);
    await expect(secondPush.json()).resolves.toMatchObject({
      error: { details: [{ field: "type", message: expect.stringContaining("push") }] },
    });
  });

  it("gates paid channel types behind the add-on and prices them per destination", async () => {
    const blocked = await app.request(`/api/workspaces/${WORKSPACE.id}/channels`, {
      method: "POST",
      headers: headers("owner"),
      body: JSON.stringify({
        name: "On-call",
        type: "SMS",
        config: { phoneNumber: "+34600123456", consent: true },
      }),
    });
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: [{ field: "type", message: expect.stringContaining("SMS & calls") }],
      },
    });

    await alerts.insertSettings({
      ...defaultAlertSettings(WORKSPACE.id, 1),
      paidChannelsEnabled: true,
    });
    const created = await createChannel("SMS", {
      phoneNumber: "+34600123456",
      consent: true,
    });
    expect(JSON.parse(created.responseText)).toMatchObject({
      data: {
        type: "SMS",
        isDefault: false,
        price: { cents: 18, currency: "EUR", destination: "Spain" },
        paused: { reason: "NO_CREDIT" },
      },
    });

    await alerts.credit({
      id: "ace_channels",
      workspaceId: WORKSPACE.id,
      amountCents: 100,
      kind: "GRANT",
      idempotencyKey: "grant:channels",
      description: "Grant",
      deliveryId: null,
      providerTransactionId: null,
      at: 1,
    });
    const listed = await app.request(`/api/workspaces/${WORKSPACE.id}/channels`, {
      headers: headers("member"),
    });
    await expect(listed.json()).resolves.toMatchObject({
      data: [{ id: created.id, price: { cents: 18 }, paused: null }],
    });

    const madeDefault = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}`,
      {
        method: "PATCH",
        headers: headers("admin"),
        body: JSON.stringify({ isDefault: true }),
      },
    );
    expect(madeDefault.status).toBe(200);
    await expect(madeDefault.json()).resolves.toMatchObject({
      data: { isDefault: true },
    });
    await expect(channels.findById(WORKSPACE.id, created.id)).resolves.toMatchObject({
      isDefault: true,
    });

    await alerts.updateSettings(WORKSPACE.id, { paidChannelsEnabled: false }, 2);
    const disabled = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}`,
      {
        method: "PATCH",
        headers: headers("admin"),
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(disabled.status).toBe(200);
    const reenabled = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}`,
      {
        method: "PATCH",
        headers: headers("admin"),
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(reenabled.status).toBe(400);
    await expect(reenabled.json()).resolves.toMatchObject({
      error: { details: [{ field: "enabled" }] },
    });
  });

  it("charges a test SMS from the credit and records its cost", async () => {
    await alerts.insertSettings({
      ...defaultAlertSettings(WORKSPACE.id, 1),
      paidChannelsEnabled: true,
    });
    const created = await createChannel("SMS", {
      phoneNumber: "+34600123456",
      consent: true,
    });
    const skipped = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
      { method: "POST", headers: headers("owner") },
    );
    expect(skipped.status).toBe(200);
    await expect(skipped.json()).resolves.toMatchObject({
      data: {
        delivery: {
          status: "FAILED",
          errorSanitized: expect.stringContaining("not enough alert credit"),
          costCents: null,
        },
      },
    });
    expect(sender.calls).toHaveLength(0);

    await alerts.credit({
      id: "ace_test",
      workspaceId: WORKSPACE.id,
      amountCents: 50,
      kind: "GRANT",
      idempotencyKey: "grant:test",
      description: "Grant",
      deliveryId: null,
      providerTransactionId: null,
      at: 1,
    });
    const sent = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
      { method: "POST", headers: headers("owner") },
    );
    expect(sent.status).toBe(200);
    await expect(sent.json()).resolves.toMatchObject({
      data: {
        delivery: { status: "SENT", costCents: 18, destinationCountry: "Spain" },
      },
    });
    expect(sender.calls).toHaveLength(1);
    await expect(alerts.getBalanceCents(WORKSPACE.id)).resolves.toBe(32);

    sender.failure = new Error("twilio error 500");
    const failed = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
      { method: "POST", headers: headers("owner") },
    );
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toMatchObject({
      data: { delivery: { status: "FAILED", costCents: null } },
    });
    await expect(alerts.getBalanceCents(WORKSPACE.id)).resolves.toBe(32);
  });

  it("records successful and failed test deliveries and keyset-paginates them", async () => {
    const created = await createChannel("SLACK", { webhookUrl: WEBHOOK_URL });
    const sent = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
      { method: "POST", headers: headers("admin") },
    );
    const sentText = await sent.text();
    expect(sent.status).toBe(200);
    expect(sentText).not.toContain(WEBHOOK_URL);
    const sentBody = JSON.parse(sentText) as {
      data: { delivery: { id: string; status: string; attemptCount: number } };
    };
    expect(sentBody.data.delivery).toMatchObject({
      status: "SENT",
      attemptCount: 1,
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      channel: { type: "SLACK", config: { webhookUrl: WEBHOOK_URL } },
      message: { eventType: "TEST", color: "gray" },
    });

    sender.failure = new Error(`provider echoed ${WEBHOOK_URL}`);
    const failed = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
      { method: "POST", headers: headers("owner") },
    );
    const failedText = await failed.text();
    expect(failed.status).toBe(200);
    expect(failedText).not.toContain(WEBHOOK_URL);
    expect(JSON.parse(failedText)).toMatchObject({
      data: {
        delivery: {
          status: "FAILED",
          attemptCount: 1,
          errorSanitized: "provider echoed {{CHANNEL_CONFIG_2}}",
        },
      },
    });

    const storedChannel = await channels.findById(WORKSPACE.id, created.id);
    expect(storedChannel).toMatchObject({
      verifiedAt: expect.any(Number),
      lastDeliveryStatus: "FAILED",
    });
    const storedDeliveries = await deliveries.listForChannel(
      created.id,
      null,
      10,
    );
    expect(storedDeliveries.map(({ status }) => status)).toEqual([
      "FAILED",
      "SENT",
    ]);
    expect(JSON.stringify(storedDeliveries)).not.toContain(WEBHOOK_URL);

    const firstPage = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/deliveries?limit=1`,
      { headers: headers("member") },
    );
    const firstPageText = await firstPage.text();
    expect(firstPage.status).toBe(200);
    expect(firstPageText).not.toContain(WEBHOOK_URL);
    const firstPageBody = JSON.parse(firstPageText) as {
      data: { id: string }[];
      nextCursor: string | null;
    };
    expect(firstPageBody.data).toHaveLength(1);
    expect(firstPageBody.nextCursor).not.toBeNull();
    const secondPage = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/deliveries?limit=1&cursor=${firstPageBody.nextCursor ?? ""}`,
      { headers: headers("member") },
    );
    await expect(secondPage.json()).resolves.toMatchObject({
      data: [{ id: sentBody.data.delivery.id }],
      nextCursor: null,
    });
  });

  it("lets members read but returns 403 for every mutation", async () => {
    const created = await createChannel();
    const attempts = [
      app.request(`/api/workspaces/${WORKSPACE.id}/channels`, {
        method: "POST",
        headers: headers("member"),
        body: JSON.stringify({
          name: "Forbidden",
          type: "EMAIL",
          config: { emails: ["member@example.com"] },
        }),
      }),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/channels/${created.id}`,
        {
          method: "PATCH",
          headers: headers("member"),
          body: JSON.stringify({ enabled: false }),
        },
      ),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/channels/${created.id}`,
        { method: "DELETE", headers: headers("member") },
      ),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
        { method: "POST", headers: headers("member") },
      ),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }
    expect(sender.calls).toHaveLength(0);
    expect(
      (
        await app.request(`/api/workspaces/${WORKSPACE.id}/channels`, {
          headers: headers("member"),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/deliveries`,
          { headers: headers("member") },
        )
      ).status,
    ).toBe(200);
  });

  it("requires an active subscription for mutations but leaves reads available", async () => {
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      status: "CANCELED",
      updatedAt: 2,
    });
    const blocked = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          name: "Blocked",
          type: "EMAIL",
          config: { emails: ["ops@example.com"] },
        }),
      },
    );
    expect(blocked.status).toBe(402);
    expect(
      (
        await app.request(`/api/workspaces/${WORKSPACE.id}/channels`, {
          headers: headers("member"),
        })
      ).status,
    ).toBe(200);
  });

  it("rate limits test sends to five per hour per channel", async () => {
    const created = await createChannel();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.request(
        `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
        { method: "POST", headers: headers("owner") },
      );
      expect(response.status).toBe(200);
    }
    const blocked = await app.request(
      `/api/workspaces/${WORKSPACE.id}/channels/${created.id}/test`,
      { method: "POST", headers: headers("owner") },
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(sender.calls).toHaveLength(5);
    await expect(
      deliveries.listForChannel(created.id, null, 10),
    ).resolves.toHaveLength(5);
  });
});
