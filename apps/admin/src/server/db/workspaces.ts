import { isMigrationPendingError } from "./errors";

export type LastRunStatus = "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR";

export interface WorkspaceActivitySummary {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  memberCount: number;
  createdAt: number;
  /** Newest event with a user behind it; system-originated rows do not count. */
  lastActiveAt: number | null;
  lastWebAt: number | null;
  lastAppAt: number | null;
  /** Newest `user.logged_in` of any current member (logins carry no workspace). */
  lastLoginAt: number | null;
  lastTestCreatedAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: LastRunStatus | null;
  lastAlertSentAt: number | null;
}

export type WorkspacesResponse =
  | { workspaces: WorkspaceActivitySummary[] }
  | { unavailable: "MIGRATION_PENDING" };

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  created_at: number;
  owner_email: string | null;
  member_count: number;
  last_active_at: number | null;
  last_web_at: number | null;
  last_app_at: number | null;
  last_login_at: number | null;
  last_test_created_at: number | null;
  last_run_at: number | null;
  last_run_type: string | null;
  last_alert_sent_at: number | null;
}

const RUN_STATUS_BY_EVENT_TYPE: Record<string, LastRunStatus> = {
  "browser_test.run_passed": "PASSED",
  "browser_test.run_failed": "FAILED",
  "browser_test.run_timed_out": "TIMEOUT",
  "browser_test.run_errored": "SYSTEM_ERROR",
};

const RUN_EVENT_TYPES = Object.keys(RUN_STATUS_BY_EVENT_TYPE)
  .map((type) => `'${type}'`)
  .join(", ");

// Every subquery is an index seek (idx_activity_ws_time, idx_activity_ws_type_time,
// idx_activity_user_type_time): MAX() with equality on the indexed prefix, never an
// ORDER BY ... LIMIT 1 walk over the workspace's whole range. The login subquery
// uses CROSS JOIN so SQLite keeps members as the outer loop (one seek per member)
// instead of scanning every login on the platform through idx_activity_type_time.
// DESC ordering already places workspaces without activity last.
const WORKSPACES_QUERY = `
  SELECT w.id, w.name, w.slug, w.created_at,
         owner.email AS owner_email,
         (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
         (SELECT MAX(e.occurred_at) FROM activity_events e
           WHERE e.workspace_id = w.id AND e.user_id IS NOT NULL) AS last_active_at,
         (SELECT MAX(e.occurred_at) FROM activity_events e
           WHERE e.workspace_id = w.id AND e.source = 'web') AS last_web_at,
         (SELECT MAX(e.occurred_at) FROM activity_events e
           WHERE e.workspace_id = w.id AND e.source = 'app') AS last_app_at,
         (SELECT MAX(e.occurred_at) FROM workspace_members m
            CROSS JOIN activity_events e
              ON e.user_id = m.user_id AND e.type = 'user.logged_in'
           WHERE m.workspace_id = w.id) AS last_login_at,
         (SELECT MAX(e.occurred_at) FROM activity_events e
           WHERE e.workspace_id = w.id AND e.type = 'browser_test.created') AS last_test_created_at,
         (SELECT MAX(e.occurred_at) FROM activity_events e
           WHERE e.workspace_id = w.id AND e.type IN (${RUN_EVENT_TYPES})) AS last_run_at,
         (SELECT e.type FROM activity_events e
           WHERE e.workspace_id = w.id AND e.type IN (${RUN_EVENT_TYPES})
             AND e.occurred_at = (SELECT MAX(latest.occurred_at) FROM activity_events latest
                                   WHERE latest.workspace_id = w.id
                                     AND latest.type IN (${RUN_EVENT_TYPES}))
           LIMIT 1) AS last_run_type,
         (SELECT MAX(e.occurred_at) FROM activity_events e
           WHERE e.workspace_id = w.id AND e.type = 'alert.sent') AS last_alert_sent_at
  FROM workspaces w
  LEFT JOIN users owner ON owner.id = w.owner_user_id
  WHERE w.deleted_at IS NULL
  ORDER BY last_active_at DESC, w.created_at DESC
  LIMIT ?`;

function toSummary(row: WorkspaceRow): WorkspaceActivitySummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerEmail: row.owner_email,
    memberCount: row.member_count,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    lastWebAt: row.last_web_at,
    lastAppAt: row.last_app_at,
    lastLoginAt: row.last_login_at,
    lastTestCreatedAt: row.last_test_created_at,
    lastRunAt: row.last_run_at,
    lastRunStatus:
      row.last_run_type === null ? null : (RUN_STATUS_BY_EVENT_TYPE[row.last_run_type] ?? null),
    lastAlertSentAt: row.last_alert_sent_at,
  };
}

/**
 * Live workspaces ordered by their most recent user activity, each with the
 * last time it did the things the admin asks about. Returns MIGRATION_PENDING
 * while the bound database predates migration 0038 (activity_events).
 */
export async function loadWorkspaces(
  db: D1Database,
  limit: number,
): Promise<WorkspacesResponse> {
  try {
    const { results } = await db.prepare(WORKSPACES_QUERY).bind(limit).all<WorkspaceRow>();
    return { workspaces: results.map(toSummary) };
  } catch (error) {
    if (isMigrationPendingError(error)) return { unavailable: "MIGRATION_PENDING" };
    throw error;
  }
}
