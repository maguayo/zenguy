import type { WorkspaceInvitation } from "../../domain/workspaces/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1InvitationRepo } from "./invitation_repo";

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
