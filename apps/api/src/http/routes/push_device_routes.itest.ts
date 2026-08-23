import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AlertRepo } from "../../infrastructure/db/alert_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import { D1PushDeviceRepo } from "../../infrastructure/db/push_device_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig, type Bindings } from "../../shared/config";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const TOKEN = "ExponentPushToken[pushroutes00000000000001]";
const OWNER: User = {
  id: "usr_push_owner",
  name: "Owner",
  email: "owner@push.test",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const MEMBER: User = { ...OWNER, id: "usr_push_member", name: "Member", email: "member@push.test" };
const WORKSPACE: Workspace = {
  id: "ws_push_routes",
  name: "Push Routes",
  slug: "push-routes",
  timezone: "UTC",
  ownerUserId: OWNER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_push",
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

describe("push device routes", () => {
  let bindings: Bindings;
  let app: Hono<AppEnv>;
  let tokens: { owner: string; member: string };
  let channels: D1ChannelRepo;
  let devices: D1PushDeviceRepo;
  let tests: D1BrowserTestRepo;
  let monitors: D1MonitorRepo;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    await users.insert(OWNER);
    await users.insert(MEMBER);
    await workspaces.insert(WORKSPACE);
    await members.insert({
      id: "mem_push_owner",
      workspaceId: WORKSPACE.id,
      userId: OWNER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: 1,
    });
    await members.insert({
      id: "mem_push_member",
      workspaceId: WORKSPACE.id,
      userId: MEMBER.id,
      role: "MEMBER",
      invitedBy: OWNER.id,
      joinedAt: 2,
    });
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    channels = new D1ChannelRepo(bindings.DB);
    devices = new D1PushDeviceRepo(bindings.DB);
    tests = new D1BrowserTestRepo(bindings.DB);
    monitors = new D1MonitorRepo(bindings.DB);
    await tests.insert({
      id: "bt_push",
      workspaceId: WORKSPACE.id,
      name: "Homepage",
      startUrl: "https://example.com",
      instructions: "Open the homepage",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 1,
      notifyOnRecovery: true,
      nextRunAt: 10,
      createdBy: OWNER.id,
      updatedBy: OWNER.id,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    await monitors.insert({
      id: "mon_push",
      workspaceId: WORKSPACE.id,
      name: "API",
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
      nextCheckAt: 10,
      currentStatus: "UNKNOWN",
      currentCycleId: null,
      cycleStartedAt: null,
      lastCheckAt: null,
      lastResponseTimeMs: null,
      createdBy: OWNER.id,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    const config = loadConfig(bindings);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, OWNER, systemClock)}`,
      member: `Bearer ${await issueAccessToken(config, MEMBER, systemClock)}`,
    };
    app = buildApp(bindings);
  });

  function headers(token: string): HeadersInit {
    return { Authorization: token, "content-type": "application/json" };
  }

  it("registers a device, creates the default push channel, and attaches it everywhere", async () => {
    const registered = await app.request("/api/me/push-devices", {
      method: "PUT",
      headers: headers(tokens.member),
      body: JSON.stringify({
        token: TOKEN,
        platform: "ios",
        deviceName: "Member iPhone",
        appVersion: "0.1.0",
      }),
    });
    expect(registered.status).toBe(200);
    const registeredBody = (await registered.json()) as {
      data: { id: string; tokenSuffix: string; enabled: boolean };
    };
    expect(registeredBody.data).toMatchObject({
      platform: "ios",
      deviceName: "Member iPhone",
      appVersion: "0.1.0",
      enabled: true,
      tokenSuffix: "000001",
    });
    expect(JSON.stringify(registeredBody)).not.toContain(TOKEN);

    const pushChannels = (await channels.list(WORKSPACE.id)).filter(
      (channel) => channel.type === "PUSH",
    );
    expect(pushChannels).toHaveLength(1);
    expect(pushChannels[0]).toMatchObject({ name: "Mobile push", isDefault: true, enabled: true });
    expect(await tests.getChannelIds("bt_push")).toEqual([pushChannels[0]?.id]);
    expect(await monitors.getChannelIds("mon_push")).toEqual([pushChannels[0]?.id]);
    await expect(
      new D1AlertRepo(bindings.DB).findSettings(WORKSPACE.id),
    ).resolves.toMatchObject({ defaultPushChannelCreatedAt: expect.any(Number) });

    const listed = await app.request(`/api/workspaces/${WORKSPACE.id}/channels`, {
      headers: headers(tokens.owner),
    });
    await expect(listed.json()).resolves.toMatchObject({
      data: [
        {
          type: "PUSH",
          isDefault: true,
          price: null,
          paused: null,
          reach: { devices: 1, members: 1 },
          configPreview: { recipients: "WORKSPACE_MEMBERS" },
        },
      ],
    });

    // Re-registering the same token is idempotent and never adds channels.
    const again = await app.request("/api/me/push-devices", {
      method: "PUT",
      headers: headers(tokens.member),
      body: JSON.stringify({ token: TOKEN, platform: "ios" }),
    });
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toMatchObject({ data: { id: registeredBody.data.id } });
    expect(await channels.list(WORKSPACE.id)).toHaveLength(1);
  });

  it("lists, pauses, and removes only the caller's devices", async () => {
    const registered = (await (
      await app.request("/api/me/push-devices", {
        method: "PUT",
        headers: headers(tokens.owner),
        body: JSON.stringify({ token: TOKEN, platform: "ios" }),
      })
    ).json()) as { data: { id: string } };
    const id = registered.data.id;

    const ownerList = await app.request("/api/me/push-devices", { headers: headers(tokens.owner) });
    await expect(ownerList.json()).resolves.toMatchObject({ data: [{ id, enabled: true }] });
    const memberList = await app.request("/api/me/push-devices", { headers: headers(tokens.member) });
    await expect(memberList.json()).resolves.toEqual({ data: [] });

    const paused = await app.request(`/api/me/push-devices/${id}`, {
      method: "PATCH",
      headers: headers(tokens.owner),
      body: JSON.stringify({ enabled: false }),
    });
    expect(paused.status).toBe(200);
    await expect(paused.json()).resolves.toMatchObject({ data: { id, enabled: false } });
    await expect(devices.findById(OWNER.id, id)).resolves.toMatchObject({ enabled: false });

    const foreign = await app.request(`/api/me/push-devices/${id}`, {
      method: "PATCH",
      headers: headers(tokens.member),
      body: JSON.stringify({ enabled: true }),
    });
    expect(foreign.status).toBe(404);
    const foreignDelete = await app.request(`/api/me/push-devices/${id}`, {
      method: "DELETE",
      headers: headers(tokens.member),
    });
    expect(foreignDelete.status).toBe(404);

    const removed = await app.request(`/api/me/push-devices/${id}`, {
      method: "DELETE",
      headers: headers(tokens.owner),
    });
    expect(removed.status).toBe(204);
    await expect(devices.findById(OWNER.id, id)).resolves.toBeNull();
  });

  it("validates tokens and requires authentication", async () => {
    const invalid = await app.request("/api/me/push-devices", {
      method: "PUT",
      headers: headers(tokens.owner),
      body: JSON.stringify({ token: "apns:nope", platform: "ios" }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR", details: [{ field: "token" }] },
    });
    const anonymous = await app.request("/api/me/push-devices");
    expect(anonymous.status).toBe(401);
  });
});
