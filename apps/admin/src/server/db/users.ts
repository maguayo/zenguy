import type { UserSummary } from "../../shared/types";

interface UserRow {
  id: string;
  email: string;
  name: string;
  created_at: number;
  email_verified_at: number | null;
  workspace_count: number;
  last_active_at: number | null;
}

/**
 * Accounts ordered by last activity (the newest refresh token). Never selects
 * password_hash or token_hash.
 */
export async function loadUsers(db: D1Database, limit: number): Promise<UserSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT users.id, users.email, users.name, users.created_at, users.email_verified_at,
              (SELECT COUNT(*) FROM workspace_members AS members
                 JOIN workspaces ON workspaces.id = members.workspace_id
                  AND workspaces.deleted_at IS NULL
                WHERE members.user_id = users.id) AS workspace_count,
              (SELECT MAX(tokens.created_at) FROM refresh_tokens AS tokens
                WHERE tokens.user_id = users.id) AS last_active_at
       FROM users
       ORDER BY last_active_at DESC, users.created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<UserRow>();

  return results.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    emailVerified: row.email_verified_at !== null,
    workspaceCount: row.workspace_count,
    lastActiveAt: row.last_active_at,
  }));
}
