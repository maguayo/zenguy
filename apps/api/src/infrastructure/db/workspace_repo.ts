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
            : "SELECT * FROM workspaces WHERE id = ? AND deleted_at IS NULL",
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
           WHERE id = ? AND deleted_at IS NULL`,
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
          "UPDATE workspaces SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(at, at, id),
    );
  }

  async transferOwnership(
    id: string,
    oldOwnerUserId: string,
    newOwnerUserId: string,
    at: number,
  ): Promise<void> {
    await batch(this.database, [
      this.database
        .prepare(
          "UPDATE workspaces SET owner_user_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(newOwnerUserId, at, id),
      this.database
        .prepare(
          "UPDATE workspace_members SET role = 'OWNER' WHERE workspace_id = ? AND user_id = ?",
        )
        .bind(id, newOwnerUserId),
      this.database
        .prepare(
          "UPDATE workspace_members SET role = 'ADMIN' WHERE workspace_id = ? AND user_id = ?",
        )
        .bind(id, oldOwnerUserId),
    ]);
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
