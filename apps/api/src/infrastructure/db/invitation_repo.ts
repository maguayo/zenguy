import type { InvitationRepo } from "../../domain/workspaces/repo";
import type { WorkspaceInvitation } from "../../domain/workspaces/types";
import { all, one, run } from "./d1";

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

  async markAccepted(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE workspace_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .bind(at, id),
    );
  }

  async revoke(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE workspace_invitations SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .bind(at, id),
    );
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
