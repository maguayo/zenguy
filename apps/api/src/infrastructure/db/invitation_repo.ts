import type { InvitationRepo } from "../../domain/workspaces/repo";
import type { Role, WorkspaceInvitation } from "../../domain/workspaces/types";
import { all, batch, one, run } from "./d1";

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceInvitation["role"];
  token_hash: string;
  invited_by: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

function toInvitation(row: InvitationRow): WorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    tokenHash: row.token_hash,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export class D1InvitationRepo implements InvitationRepo {
  constructor(private readonly database: D1Database) {}

  async insert(invitation: WorkspaceInvitation): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO workspace_invitations
            (id, workspace_id, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          invitation.id,
          invitation.workspaceId,
          invitation.email,
          invitation.role,
          invitation.tokenHash,
          invitation.invitedBy,
          invitation.expiresAt,
          invitation.acceptedAt,
          invitation.revokedAt,
          invitation.createdAt,
        ),
    );
  }

  async findByHash(hash: string): Promise<WorkspaceInvitation | null> {
    const row = await one<InvitationRow>(
      this.database
        .prepare("SELECT * FROM workspace_invitations WHERE token_hash = ?")
        .bind(hash),
    );
    return row === null ? null : toInvitation(row);
  }

  async findPending(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const rows = await all<InvitationRow>(
      this.database
        .prepare(
          `SELECT * FROM workspace_invitations
           WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(workspaceId),
    );
    return rows.map(toInvitation);
  }

  async findValidByHash(
    hash: string,
    now: number,
  ): Promise<WorkspaceInvitation | null> {
    const row = await one<InvitationRow>(
      this.database
        .prepare(
          `SELECT * FROM workspace_invitations
           WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
        )
        .bind(hash, now),
    );
    return row === null ? null : toInvitation(row);
  }

  async findPendingByEmail(
    workspaceId: string,
    email: string,
  ): Promise<WorkspaceInvitation | null> {
    const row = await one<InvitationRow>(
      this.database
        .prepare(
          `SELECT * FROM workspace_invitations
           WHERE workspace_id = ? AND email = ? COLLATE NOCASE
             AND accepted_at IS NULL AND revoked_at IS NULL
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .bind(workspaceId, email),
    );
    return row === null ? null : toInvitation(row);
  }

  async acceptByHash(input: {
    hash: string;
    email: string;
    userId: string;
    memberId: string;
    now: number;
  }): Promise<WorkspaceInvitation | null> {
    const authority = `(inviter.role = 'OWNER'
      OR (inviter.role = 'ADMIN' AND invitation.role = 'MEMBER'))`;
    const [inserted, accepted] = await batch<InvitationRow>(this.database, [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO workspace_members
            (id, workspace_id, user_id, role, invited_by, joined_at)
           SELECT ?, invitation.workspace_id, ?, invitation.role,
                  invitation.invited_by, ?
           FROM workspace_invitations invitation
           JOIN workspace_members inviter
             ON inviter.workspace_id = invitation.workspace_id
            AND inviter.user_id = invitation.invited_by
           JOIN workspaces workspace ON workspace.id = invitation.workspace_id
           WHERE invitation.token_hash = ?
             AND invitation.email = ? COLLATE NOCASE
             AND invitation.accepted_at IS NULL
             AND invitation.revoked_at IS NULL
             AND invitation.expires_at > ?
             AND workspace.deleted_at IS NULL
             AND ${authority}`,
        )
        .bind(
          input.memberId,
          input.userId,
          input.now,
          input.hash,
          input.email,
          input.now,
        ),
      this.database
        .prepare(
          `UPDATE workspace_invitations AS invitation
           SET accepted_at = ?
           WHERE invitation.token_hash = ?
             AND invitation.email = ? COLLATE NOCASE
             AND invitation.accepted_at IS NULL
             AND invitation.revoked_at IS NULL
             AND invitation.expires_at > ?
             AND EXISTS (
               SELECT 1 FROM workspaces workspace
               WHERE workspace.id = invitation.workspace_id
                 AND workspace.deleted_at IS NULL
             )
             AND EXISTS (
               SELECT 1 FROM workspace_members target
               WHERE target.workspace_id = invitation.workspace_id
                 AND target.user_id = ?
             )
             AND EXISTS (
               SELECT 1 FROM workspace_members inviter
               WHERE inviter.workspace_id = invitation.workspace_id
                 AND inviter.user_id = invitation.invited_by
                 AND (inviter.role = 'OWNER'
                   OR (inviter.role = 'ADMIN' AND invitation.role = 'MEMBER'))
             )
           RETURNING *`,
        )
        .bind(
          input.now,
          input.hash,
          input.email,
          input.now,
          input.userId,
        ),
    ]);
    void inserted;
    const row = accepted?.results[0];
    return row === undefined ? null : toInvitation(row);
  }

  async markAccepted(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE workspace_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .bind(at, id),
    );
  }

  async revoke(id: string, at: number): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          "UPDATE workspace_invitations SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .bind(at, id),
    );
    return result.meta.changes === 1;
  }

  async revokeUnauthorizedByInviter(
    workspaceId: string,
    inviterUserId: string,
    currentRole: Role | null,
    at: number,
  ): Promise<number> {
    if (currentRole === "OWNER") return 0;
    const result = await run(
      this.database
        .prepare(
          `UPDATE workspace_invitations SET revoked_at = ?
           WHERE workspace_id = ? AND invited_by = ?
             AND accepted_at IS NULL AND revoked_at IS NULL
             AND (? != 'ADMIN' OR role = 'ADMIN')`,
        )
        .bind(at, workspaceId, inviterUserId, currentRole ?? "NONE"),
    );
    return result.meta.changes;
  }

  async revokeAllForWorkspace(workspaceId: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE workspace_invitations SET revoked_at = ?
           WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
        )
        .bind(at, workspaceId),
    );
  }
}
