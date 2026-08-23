import type { WorkspaceInvitation } from "../../domain/workspaces/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1InvitationRepo } from "./invitation_repo";
import { D1MemberRepo } from "./member_repo";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceRepo } from "./workspace_repo";
import type { User } from "../../domain/users/types";

const INVITATION: WorkspaceInvitation = {
  id: "inv_alice",
  workspaceId: "ws_primary",
  email: "alice@example.com",
  role: "MEMBER",
  tokenHash: "invitation-hash",
  invitedBy: "usr_owner",
  expiresAt: 2_000,
  acceptedAt: null,
  revokedAt: null,
  createdAt: 1_000,
};

describe("D1InvitationRepo", () => {
  let repo: D1InvitationRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1InvitationRepo(testEnv().DB);
  });

  async function seedAuthority(role: "OWNER" | "ADMIN" | "MEMBER") {
    const users = new D1UserRepo(testEnv().DB);
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const members = new D1MemberRepo(testEnv().DB);
    const base = (id: string, email: string): User => ({
      id,
      name: id,
      email,
      passwordHash: "hash",
      emailVerifiedAt: 1,
      authVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await users.insert(base("usr_owner", "owner@example.com"));
    await users.insert(base("usr_alice", INVITATION.email));
    await workspaces.insert({
      id: INVITATION.workspaceId,
      name: "Primary",
      slug: "primary",
      timezone: "UTC",
      ownerUserId: "usr_owner",
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    await members.insert({
      id: "mem_inviter",
      workspaceId: INVITATION.workspaceId,
      userId: "usr_owner",
      role,
      invitedBy: null,
      joinedAt: 1,
    });
    return members;
  }

  it("atomically accepts once and revalidates the inviter's current authority", async () => {
    const members = await seedAuthority("OWNER");
    await repo.insert(INVITATION);

    const results = await Promise.all([
      repo.acceptByHash({
        hash: INVITATION.tokenHash,
        email: INVITATION.email,
        userId: "usr_alice",
        memberId: "mem_alice_a",
        now: 1_500,
      }),
      repo.acceptByHash({
        hash: INVITATION.tokenHash,
        email: INVITATION.email,
        userId: "usr_alice",
        memberId: "mem_alice_b",
        now: 1_500,
      }),
    ]);
    expect(results.filter((invitation) => invitation !== null)).toHaveLength(1);
    await expect(members.find(INVITATION.workspaceId, "usr_alice")).resolves.toMatchObject({
      role: "MEMBER",
    });

    await freshDb();
    const demotedMembers = await seedAuthority("MEMBER");
    await repo.insert(INVITATION);
    await expect(
      repo.acceptByHash({
        hash: INVITATION.tokenHash,
        email: INVITATION.email,
        userId: "usr_alice",
        memberId: "mem_alice_denied",
        now: 1_500,
      }),
    ).resolves.toBeNull();
    await expect(
      demotedMembers.find(INVITATION.workspaceId, "usr_alice"),
    ).resolves.toBeNull();
  });

  it("round-trips pending invitations and matches email case-insensitively", async () => {
    await repo.insert(INVITATION);

    await expect(repo.findPending(INVITATION.workspaceId)).resolves.toEqual([
      INVITATION,
    ]);
    await expect(
      repo.findPendingByEmail(INVITATION.workspaceId, "ALICE@EXAMPLE.COM"),
    ).resolves.toEqual(INVITATION);
    await expect(
      repo.findValidByHash(INVITATION.tokenHash, 1_999),
    ).resolves.toEqual(INVITATION);
  });

  it("findValidByHash rejects expired, accepted, and revoked invitations", async () => {
    await repo.insert(INVITATION);
    await expect(
      repo.findValidByHash(INVITATION.tokenHash, INVITATION.expiresAt),
    ).resolves.toBeNull();

    await repo.markAccepted(INVITATION.id, 1_500);
    await expect(
      repo.findValidByHash(INVITATION.tokenHash, 1_499),
    ).resolves.toBeNull();

    const revoked = {
      ...INVITATION,
      id: "inv_revoked",
      email: "other@example.com",
      tokenHash: "revoked-hash",
    };
    await repo.insert(revoked);
    await repo.revoke(revoked.id, 1_500);
    await expect(repo.findValidByHash(revoked.tokenHash, 1_499)).resolves.toBeNull();
  });

  it("revokes all pending invitations without changing accepted ones", async () => {
    const accepted = {
      ...INVITATION,
      id: "inv_accepted",
      email: "accepted@example.com",
      tokenHash: "accepted-hash",
      acceptedAt: 1_200,
    };
    await repo.insert(INVITATION);
    await repo.insert(accepted);

    await repo.revokeAllForWorkspace(INVITATION.workspaceId, 1_500);

    await expect(repo.findPending(INVITATION.workspaceId)).resolves.toEqual([]);
    const acceptedRow = await testEnv().DB.prepare(
      "SELECT accepted_at, revoked_at FROM workspace_invitations WHERE id = ?",
    )
      .bind(accepted.id)
      .first<{ accepted_at: number | null; revoked_at: number | null }>();
    expect(acceptedRow).toEqual({ accepted_at: 1_200, revoked_at: null });
  });
});
