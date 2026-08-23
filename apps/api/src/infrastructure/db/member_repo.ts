import type {
  MemberRepo,
  WorkspaceMemberWithUser,
} from "../../domain/workspaces/repo";
import type {
  Role,
  WorkspaceMember,
} from "../../domain/workspaces/types";
import { all, batch, one, run } from "./d1";

interface MemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  invited_by: string | null;
  joined_at: number;
}

interface MemberWithUserRow extends MemberRow {
  user_name: string;
  user_email: string;
}

function toMember(row: MemberRow): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    invitedBy: row.invited_by,
    joinedAt: row.joined_at,
  };
}

export class D1MemberRepo implements MemberRepo {
  constructor(private readonly database: D1Database) {}

  async insert(member: WorkspaceMember): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO workspace_members
            (id, workspace_id, user_id, role, invited_by, joined_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          member.id,
          member.workspaceId,
          member.userId,
          member.role,
          member.invitedBy,
          member.joinedAt,
        ),
    );
  }

  async find(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    const row = await one<MemberRow>(
      this.database
        .prepare(
          "SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
        )
        .bind(workspaceId, userId),
    );
    return row === null ? null : toMember(row);
  }

  async list(workspaceId: string): Promise<WorkspaceMemberWithUser[]> {
    const rows = await all<MemberWithUserRow>(
      this.database
        .prepare(
          `SELECT wm.*, u.name AS user_name, u.email AS user_email
           FROM workspace_members wm
           JOIN users u ON u.id = wm.user_id
           WHERE wm.workspace_id = ?
           ORDER BY wm.joined_at ASC, wm.id ASC`,
        )
        .bind(workspaceId),
    );
    return rows.map((row) => ({
      ...toMember(row),
      userName: row.user_name,
      userEmail: row.user_email,
    }));
  }

  async updateRole(
    workspaceId: string,
    userId: string,
    role: Role,
    at = Date.now(),
  ): Promise<void> {
    if (role === "MEMBER") {
      await batch(this.database, [
        this.database
          .prepare(
            "UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ? AND role != 'OWNER'",
          )
          .bind(role, workspaceId, userId),
        this.database
          .prepare(
            `UPDATE workspace_invitations SET revoked_at = ?
             WHERE workspace_id = ? AND invited_by = ?
               AND accepted_at IS NULL AND revoked_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM workspace_members member
                 WHERE member.workspace_id = workspace_invitations.workspace_id
                   AND member.user_id = workspace_invitations.invited_by
                   AND member.role = 'MEMBER'
               )`,
          )
          .bind(at, workspaceId, userId),
        this.database
          .prepare(
            `UPDATE workspace_api_keys SET revoked_at = ?
             WHERE workspace_id = ? AND created_by = ? AND revoked_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM workspace_members member
                 WHERE member.workspace_id = workspace_api_keys.workspace_id
                   AND member.user_id = workspace_api_keys.created_by
                   AND member.role = 'MEMBER'
               )`,
          )
          .bind(at, workspaceId, userId),
        this.database
          .prepare(
            `UPDATE notification_channels SET enabled = 0, updated_at = ?
             WHERE workspace_id = ? AND created_by = ? AND enabled = 1
               AND EXISTS (
                 SELECT 1 FROM workspace_members member
                 WHERE member.workspace_id = notification_channels.workspace_id
                   AND member.user_id = notification_channels.created_by
                   AND member.role = 'MEMBER'
               )`,
          )
          .bind(at, workspaceId, userId),
      ]);
      return;
    }
    await run(
      this.database
        .prepare(
          "UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?",
        )
        .bind(role, workspaceId, userId),
    );
  }

  async remove(
    workspaceId: string,
    userId: string,
    at = Date.now(),
  ): Promise<void> {
    await batch(this.database, [
      this.database
        .prepare(
          `UPDATE workspace_invitations SET revoked_at = ?
           WHERE workspace_id = ? AND invited_by = ?
             AND accepted_at IS NULL AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM workspace_members member
               WHERE member.workspace_id = workspace_invitations.workspace_id
                 AND member.user_id = workspace_invitations.invited_by
                 AND member.role != 'OWNER'
             )`,
        )
        .bind(at, workspaceId, userId),
      this.database
        .prepare(
          `UPDATE workspace_api_keys SET revoked_at = ?
           WHERE workspace_id = ? AND created_by = ? AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM workspace_members member
               WHERE member.workspace_id = workspace_api_keys.workspace_id
                 AND member.user_id = workspace_api_keys.created_by
                 AND member.role != 'OWNER'
             )`,
        )
        .bind(at, workspaceId, userId),
      this.database
        .prepare(
          `UPDATE notification_channels SET enabled = 0, updated_at = ?
           WHERE workspace_id = ? AND created_by = ? AND enabled = 1
             AND EXISTS (
               SELECT 1 FROM workspace_members member
               WHERE member.workspace_id = notification_channels.workspace_id
                 AND member.user_id = notification_channels.created_by
                 AND member.role != 'OWNER'
             )`,
        )
        .bind(at, workspaceId, userId),
      this.database
        .prepare(
          "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role != 'OWNER'",
        )
        .bind(workspaceId, userId),
    ]);
  }
}
