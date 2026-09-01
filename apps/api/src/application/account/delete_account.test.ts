import type { WorkspaceDeletionCoordinator } from "../workspaces/delete_workspace";
import type { AccountDeletionRepo } from "../../domain/users/account_deletion";
import type { Workspace, WorkspaceMember } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { hashPassword } from "../../shared/crypto";
import {
  FakeMemberRepo,
  FakeWorkspaceRepo,
  FakeWorkspaceState,
} from "../../test/fakes/repos";
import { testUser } from "../../test/fakes/auth";
import { DeleteAccount } from "./delete_account";

const NOW = 1_780_000_000_000;

class RecordingAccountDeletion implements AccountDeletionRepo {
  calls: Parameters<AccountDeletionRepo["finalize"]>[0][] = [];

  async finalize(input: Parameters<AccountDeletionRepo["finalize"]>[0]): Promise<void> {
    this.calls.push(input);
  }
}

class RecordingWorkspaceDeletion implements WorkspaceDeletionCoordinator {
  calls: string[] = [];
  failFor: string | null = null;

  async request(workspaceId: string): Promise<boolean> {
    this.calls.push(workspaceId);
    if (workspaceId === this.failFor) throw new Error("tombstone failed");
    return true;
  }
}

function workspace(id: string, ownerUserId: string, createdAt: number): Workspace {
  return {
    id,
    name: id,
    slug: id,
    timezone: "UTC",
    ownerUserId,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function member(
  id: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceMember["role"],
): WorkspaceMember {
  return { id, workspaceId, userId, role, invitedBy: null, joinedAt: NOW - 1_000 };
}

async function fixture() {
  const state = new FakeWorkspaceState();
  const workspaces = new FakeWorkspaceRepo(state);
  const members = new FakeMemberRepo(state);
  const deletion = new RecordingWorkspaceDeletion();
  const accountDeletion = new RecordingAccountDeletion();
  const actor = testUser({
    passwordHash: await hashPassword("correct-password"),
    emailVerifiedAt: NOW - 10_000,
  });

  await workspaces.insert(workspace("ws_owned_1", actor.id, NOW - 3_000));
  await workspaces.insert(workspace("ws_joined", "usr_other", NOW - 2_000));
  await workspaces.insert(workspace("ws_owned_2", actor.id, NOW - 1_000));
  await members.insert(member("mem_1", "ws_owned_1", actor.id, "OWNER"));
  await members.insert(member("mem_2", "ws_joined", actor.id, "ADMIN"));
  await members.insert(member("mem_3", "ws_owned_2", actor.id, "OWNER"));

  return {
    actor,
    members,
    deletion,
    accountDeletion,
    service: new DeleteAccount(
      workspaces,
      members,
      deletion,
      accountDeletion,
      new FixedClock(NOW),
    ),
  };
}

describe("DeleteAccount", () => {
  it("deletes every owned workspace, leaves joined workspaces, then anonymizes the account", async () => {
    const value = await fixture();

    await value.service.execute({
      actor: value.actor,
      password: "correct-password",
      confirmation: "DELETE",
    });

    expect(new Set(value.deletion.calls)).toEqual(new Set(["ws_owned_1", "ws_owned_2"]));
    await expect(value.members.find("ws_joined", value.actor.id)).resolves.toBeNull();
    await expect(value.members.find("ws_owned_1", value.actor.id)).resolves.toMatchObject({
      role: "OWNER",
    });
    expect(value.accountDeletion.calls).toEqual([
      { userId: value.actor.id, email: value.actor.email, at: NOW },
    ]);
  });

  it("does nothing when the password is wrong", async () => {
    const value = await fixture();

    await expect(
      value.service.execute({
        actor: value.actor,
        password: "wrong-password",
        confirmation: "DELETE",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(value.deletion.calls).toEqual([]);
    expect(value.accountDeletion.calls).toEqual([]);
    await expect(value.members.find("ws_joined", value.actor.id)).resolves.not.toBeNull();
  });

  it("never tombstones the account when an owned workspace could not be quiesced", async () => {
    const value = await fixture();
    value.deletion.failFor = "ws_owned_1";

    await expect(
      value.service.execute({
        actor: value.actor,
        password: "correct-password",
        confirmation: "DELETE",
      }),
    ).rejects.toThrow("tombstone failed");

    expect(value.accountDeletion.calls).toEqual([]);
    await expect(value.members.find("ws_joined", value.actor.id)).resolves.not.toBeNull();
  });
});
