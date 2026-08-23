import { isMigrationPendingError } from "./errors";

export type ActivitySource = "web" | "app" | "api" | "server";

export interface ActivityFeedEvent {
  id: string;
  type: string;
  occurredAt: number;
  source: ActivitySource;
  /** Null for system-originated events, or when the user no longer exists. */
  actor: { id: string; name: string; email: string } | null;
  /** Null for user-scoped events, or when the workspace no longer exists. */
  workspace: { id: string; name: string } | null;
  resourceType: string | null;
  resourceId: string | null;
  properties: Record<string, unknown> | null;
}

export type ActivityFeedResponse =
  | { events: ActivityFeedEvent[] }
  | { unavailable: "MIGRATION_PENDING" };

interface ActivityRow {
  id: string;
  type: string;
  occurred_at: number;
  source: ActivitySource;
  resource_type: string | null;
  resource_id: string | null;
  properties_json: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
}

// The type filter is bound twice so a null disables it; the scan walks
// idx_activity_time newest first and stops at the limit.
const ACTIVITY_FEED_QUERY = `
  SELECT e.id, e.type, e.occurred_at, e.source, e.resource_type, e.resource_id,
         e.properties_json,
         u.id AS actor_id, u.name AS actor_name, u.email AS actor_email,
         w.id AS workspace_id, w.name AS workspace_name
  FROM activity_events e
  LEFT JOIN users u ON u.id = e.user_id
  LEFT JOIN workspaces w ON w.id = e.workspace_id
  WHERE (? IS NULL OR e.type = ?)
  ORDER BY e.occurred_at DESC, e.id DESC
  LIMIT ?`;

/** The stored properties object, or null when absent or not parseable. */
function parseProperties(json: string | null): Record<string, unknown> | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toFeedEvent(row: ActivityRow): ActivityFeedEvent {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    source: row.source,
    actor:
      row.actor_id === null || row.actor_name === null || row.actor_email === null
        ? null
        : { id: row.actor_id, name: row.actor_name, email: row.actor_email },
    workspace:
      row.workspace_id === null || row.workspace_name === null
        ? null
        : { id: row.workspace_id, name: row.workspace_name },
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    properties: parseProperties(row.properties_json),
  };
}

/**
 * The newest activity events across the platform, optionally of a single
 * type, with the actor and workspace resolved. Returns MIGRATION_PENDING
 * while the bound database predates migration 0038 (activity_events).
 */
export async function loadActivityFeed(
  db: D1Database,
  limit: number,
  type: string | null,
): Promise<ActivityFeedResponse> {
  try {
    const { results } = await db
      .prepare(ACTIVITY_FEED_QUERY)
      .bind(type, type, limit)
      .all<ActivityRow>();
    return { events: results.map(toFeedEvent) };
  } catch (error) {
    if (isMigrationPendingError(error)) return { unavailable: "MIGRATION_PENDING" };
    throw error;
  }
}
