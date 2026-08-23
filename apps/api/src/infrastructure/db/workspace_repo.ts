import type {
  WorkspaceRepo,
  WorkspaceUpdate,
} from "../../domain/workspaces/repo";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { all, batch, one, run } from "./d1";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  owner_user_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface WorkspaceWithRoleRow extends WorkspaceRow {
  member_role: Role;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export class D1WorkspaceRepo implements WorkspaceRepo {
  constructor(private readonly database: D1Database) {}

  async insert(workspace: Workspace): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO workspaces
            (id, name, slug, timezone, owner_user_id, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          workspace.id,
          workspace.name,
          workspace.slug,
          workspace.timezone,
          workspace.ownerUserId,
          workspace.createdAt,
          workspace.updatedAt,
          workspace.deletedAt,
        ),
    );
  }

  async findById(
    id: string,
    includeDeleted = false,
  ): Promise<Workspace | null> {
    const row = await one<WorkspaceRow>(
      this.database
        .prepare(
          includeDeleted
            ? "SELECT * FROM workspaces WHERE id = ?"
            : `SELECT * FROM workspaces
               WHERE id = ? AND deleted_at IS NULL
                 AND deletion_state = 'ACTIVE'`,
        )
        .bind(id),
    );
    return row === null ? null : toWorkspace(row);
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const row = await one<WorkspaceRow>(
      this.database
        // Slugs remain unique after soft deletion because the database index is
        // not partial. Include deleted rows here so slug allocation cannot race
        // into a constraint violation.
        .prepare("SELECT * FROM workspaces WHERE slug = ?")
        .bind(slug),
    );
    return row === null ? null : toWorkspace(row);
  }

  async update(
    id: string,
    changes: WorkspaceUpdate,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE workspaces
           SET name = COALESCE(?, name),
               timezone = COALESCE(?, timezone),
               owner_user_id = COALESCE(?, owner_user_id),
               updated_at = ?
           WHERE id = ? AND deleted_at IS NULL AND deletion_state = 'ACTIVE'`,
        )
        .bind(
          changes.name ?? null,
          changes.timezone ?? null,
          changes.ownerUserId ?? null,
          at,
          id,
        ),
    );
  }

  async softDelete(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE workspaces SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL AND deletion_state = 'ACTIVE'`,
        )
        .bind(at, at, id),
    );
  }

  async transferOwnership(
    id: string,
    oldOwnerUserId: string,
    newOwnerUserId: string,
    at: number,
  ): Promise<boolean> {
    const [claimed] = await batch(this.database, [
      this.database
        .prepare(
          `UPDATE workspaces SET owner_user_id = ?, updated_at = ?
           WHERE id = ? AND owner_user_id = ?
             AND deleted_at IS NULL AND deletion_state = 'ACTIVE'
             AND EXISTS (
               SELECT 1 FROM workspace_members current_owner
               WHERE current_owner.workspace_id = workspaces.id
                 AND current_owner.user_id = ? AND current_owner.role = 'OWNER'
             )
             AND EXISTS (
               SELECT 1 FROM workspace_members next_owner
               WHERE next_owner.workspace_id = workspaces.id
                 AND next_owner.user_id = ?
             )`,
        )
        .bind(
          newOwnerUserId,
          at,
          id,
          oldOwnerUserId,
          oldOwnerUserId,
          newOwnerUserId,
        ),
      this.database
        .prepare(
          `UPDATE workspace_members SET role = 'ADMIN'
           WHERE workspace_id = ? AND user_id = ? AND role = 'OWNER'
             AND EXISTS (
               SELECT 1 FROM workspaces workspace
               WHERE workspace.id = workspace_members.workspace_id
                 AND workspace.owner_user_id = ?
             )`,
        )
        .bind(id, oldOwnerUserId, newOwnerUserId),
      this.database
        .prepare(
          `UPDATE workspace_members SET role = 'OWNER'
           WHERE workspace_id = ? AND user_id = ?
             AND EXISTS (
               SELECT 1 FROM workspaces workspace
               WHERE workspace.id = workspace_members.workspace_id
                 AND workspace.owner_user_id = ?
             )`,
        )
        .bind(id, newOwnerUserId, newOwnerUserId),
      this.database
        .prepare(
          `UPDATE workspace_invitations SET revoked_at = ?
           WHERE workspace_id = ? AND invited_by = ? AND role = 'ADMIN'
             AND accepted_at IS NULL AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM workspaces workspace
               WHERE workspace.id = workspace_invitations.workspace_id
                 AND workspace.owner_user_id = ?
             )`,
        )
        .bind(at, id, oldOwnerUserId, newOwnerUserId),
    ]);
    return claimed?.meta.changes === 1;
  }

  async listForUser(
    userId: string,
  ): Promise<{ workspace: Workspace; role: Role }[]> {
    const rows = await all<WorkspaceWithRoleRow>(
      this.database
        .prepare(
          `SELECT w.*, wm.role AS member_role
           FROM workspaces w
           JOIN workspace_members wm ON wm.workspace_id = w.id
           WHERE wm.user_id = ? AND w.deleted_at IS NULL
             AND w.deletion_state = 'ACTIVE'
           ORDER BY w.created_at DESC, w.id DESC`,
        )
        .bind(userId),
    );
    return rows.map((row) => ({
      workspace: toWorkspace(row),
      role: row.member_role,
    }));
  }
}
