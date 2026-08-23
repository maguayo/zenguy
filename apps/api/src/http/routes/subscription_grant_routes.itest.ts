import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const ISSUER: User = {
  id: "usr_grant_issuer",
  name: "Marcos",
  email: "marcos@aguayo.es",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const FRIEND: User = {
  id: "usr_grant_friend",
  name: "Ivy",
  email: "ivy@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const OTHER: User = {
  id: "usr_grant_other",
  name: "Other",
  email: "other@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const FRIEND_WORKSPACE: Workspace = {
  id: "ws_grant_friend",
  name: "Friend Workspace",
  slug: "friend-workspace",
  timezone: "UTC",
  ownerUserId: FRIEND.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const UNPAID_WORKSPACE: Workspace = {
  id: "ws_grant_unpaid",
  name: "Unpaid Workspace",
  slug: "unpaid-workspace",
  timezone: "UTC",
  ownerUserId: OTHER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

const TEST_CONFIG = {
  name: "Grant smoke",
  startUrl: "https://example.com",
  instructions: "Check that the page shows Example Domain",
  device: "DESKTOP",
  intervalHours: 24,
  maxRetries: 0,
  notifyOnRecovery: true,
  channelIds: [],
} as const;

describe("subscription grant routes", () => {
  let app: Hono<AppEnv>;
  let issuerToken: string;
  let friendToken: string;
  let otherToken: string;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    const bindings = {
      ...testEnv(),
      COMPLIMENTARY_ISSUER_EMAILS: "marcos@aguayo.es",
    };
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of [ISSUER, FRIEND, OTHER]) await users.insert(user);
    await workspaces.insert(FRIEND_WORKSPACE);
    await workspaces.insert(UNPAID_WORKSPACE);
    await members.insert({
      id: "mem_grant_friend",
      workspaceId: FRIEND_WORKSPACE.id,
      userId: FRIEND.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: 1,
    });
    await members.insert({
      id: "mem_grant_other",
      workspaceId: UNPAID_WORKSPACE.id,
      userId: OTHER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: 1,
    });
    const config = loadConfig(bindings);
    issuerToken = `Bearer ${await issueAccessToken(config, ISSUER, systemClock)}`;
    friendToken = `Bearer ${await issueAccessToken(config, FRIEND, systemClock)}`;
    otherToken = `Bearer ${await issueAccessToken(config, OTHER, systemClock)}`;
    app = buildApp(bindings);
  });

  it("redeems a grant once, unlocks billed work, and leaves unpaid workspaces gated", async () => {
    const stranger = await app.request("/api/subscription-grants", {
      method: "POST",
      headers: {
        Authorization: friendToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ note: "nope" }),
    });
    expect(stranger.status).toBe(403);

    const issued = await app.request("/api/subscription-grants", {
      method: "POST",
      headers: {
        Authorization: issuerToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ note: "Influencer" }),
    });
    expect(issued.status).toBe(201);
    const issuedBody = (await issued.json()) as {
      data: { token: string; redeemUrl: string };
    };
    const token = issuedBody.data.token;
    expect(issuedBody.data.redeemUrl).toBe(
      `${testEnv().APP_URL}/grants/redeem#${token}`,
    );

    const preview = await app.request("/api/subscription-grants/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(preview.status).toBe(200);

    const before = await app.request(
      `/api/workspaces/${FRIEND_WORKSPACE.id}/browser-tests`,
      {
        method: "POST",
        headers: {
          Authorization: friendToken,
          "content-type": "application/json",
        },
        body: JSON.stringify(TEST_CONFIG),
      },
    );
    expect(before.status).toBe(402);

    const redeemed = await app.request(
      "/api/subscription-grants/redeem",
      {
        method: "POST",
        headers: {
          Authorization: friendToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token, workspaceId: FRIEND_WORKSPACE.id }),
      },
    );
    expect(redeemed.status).toBe(200);
    await expect(redeemed.json()).resolves.toEqual({
      data: {
        workspaceId: FRIEND_WORKSPACE.id,
        subscriptionStatus: "ACTIVE",
      },
    });

    const created = await app.request(
      `/api/workspaces/${FRIEND_WORKSPACE.id}/browser-tests`,
      {
        method: "POST",
        headers: {
          Authorization: friendToken,
          "content-type": "application/json",
        },
        body: JSON.stringify(TEST_CONFIG),
      },
    );
    expect(created.status).toBe(201);

    const reuse = await app.request(
      "/api/subscription-grants/redeem",
      {
        method: "POST",
        headers: {
          Authorization: friendToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token, workspaceId: FRIEND_WORKSPACE.id }),
      },
    );
    expect(reuse.status).toBe(410);

    const unpaid = await app.request(
      `/api/workspaces/${UNPAID_WORKSPACE.id}/browser-tests`,
      {
        method: "POST",
        headers: {
          Authorization: otherToken,
          "content-type": "application/json",
        },
        body: JSON.stringify(TEST_CONFIG),
      },
    );
    expect(unpaid.status).toBe(402);

    const workspaces = await app.request("/api/workspaces", {
      headers: { Authorization: friendToken },
    });
    await expect(workspaces.json()).resolves.toMatchObject({
      data: [{ id: FRIEND_WORKSPACE.id, subscriptionStatus: "ACTIVE" }],
    });
  });
});
