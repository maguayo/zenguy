import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeMemberRepo,
  FakeSubscriptionGrantRepo,
  FakeSubscriptionRepo,
  FakeWorkspaceRepo,
  FakeWorkspaceState,
} from "../../test/fakes/repos";
import { RedeemSubscriptionGrant } from "./redeem_subscription_grant";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const OWNER: User = {
  id: "usr_owner",
  name: "Ivy",
  email: "ivy@example.com",
  passwordHash: "hash",
  emailVerifiedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};
const WORKSPACE: Workspace = {
  id: "ws_grant",
  name: "Grant Workspace",
  slug: "grant-workspace",
  timezone: "UTC",
  ownerUserId: OWNER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

async function setup() {
  const state = new FakeWorkspaceState();
  const workspaces = new FakeWorkspaceRepo(state);
  const members = new FakeMemberRepo(state);
  await workspaces.insert(WORKSPACE);
  await members.insert({
    id: "mem_owner",
    workspaceId: WORKSPACE.id,
    userId: OWNER.id,
    role: "OWNER",
    invitedBy: null,
    joinedAt: NOW,
  });
  const grants = new FakeSubscriptionGrantRepo();
  const token = "plain-grant-token";
  await grants.insert({
    id: "sgr_one",
    tokenHash: await sha256Hex(token),
    issuedByUserId: "usr_issuer",
    note: "friend",
    expiresAt: NOW + 86_400_000,
    redeemedAt: null,
    redeemedWorkspaceId: null,
    createdAt: NOW,
  });
  const subscriptions = new FakeSubscriptionRepo();
  const usecase = new RedeemSubscriptionGrant(
    grants,
    subscriptions,
    workspaces,
    members,
    { execute: async () => undefined },
    new FixedClock(NOW),
    new FakeIds(),
  );
  return { grants, subscriptions, token, usecase };
}

describe("RedeemSubscriptionGrant", () => {
  it("activates the workspace without a Paddle customer", async () => {
    const { grants, subscriptions, token, usecase } = await setup();

    await expect(
      usecase.execute({
        tokenPlain: token,
        workspaceId: WORKSPACE.id,
        actor: OWNER,
      }),
    ).resolves.toEqual({
      workspaceId: WORKSPACE.id,
      subscriptionStatus: "ACTIVE",
    });

    const subscription = await subscriptions.findByWorkspace(WORKSPACE.id);
    expect(subscription).toMatchObject({
      source: "grant",
      status: "ACTIVE",
      providerCustomerId: null,
      providerSubscriptionId: null,
    });
    expect(grants.grants.get("sgr_one")?.redeemedAt).toBe(NOW);
    expect(grants.grants.get("sgr_one")?.redeemedWorkspaceId).toBe(
      WORKSPACE.id,
    );
  });

  it("rejects a second redeem of the same token", async () => {
    const { token, usecase } = await setup();
    await usecase.execute({
      tokenPlain: token,
      workspaceId: WORKSPACE.id,
      actor: OWNER,
    });

    await expect(
      usecase.execute({
        tokenPlain: token,
        workspaceId: WORKSPACE.id,
        actor: OWNER,
      }),
    ).rejects.toMatchObject({ code: "GONE" });
  });
});
