import type {
  AuthDebrisCounts,
  CleanupRepo,
  DeletedWorkspacePurgeCounts,
  ExpiredRunBatch,
} from "../../domain/maintenance/repo";
import { all, batch, one, run } from "./d1";

function placeholders(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

export class D1CleanupRepo implements CleanupRepo {
  constructor(private readonly database: D1Database) {}

  async listExpiredRunBatch(
    before: number,
    limit: number,
  ): Promise<ExpiredRunBatch> {
    const runs = await all<{ id: string }>(
      this.database
        .prepare(
          `SELECT id FROM test_runs
           WHERE finished_at IS NOT NULL AND finished_at < ?
           ORDER BY finished_at ASC, id ASC LIMIT ?`,
        )
        .bind(before, limit),
    );
    const runIds = runs.map((row) => row.id);
    if (runIds.length === 0) {
      return {
        runIds: [],
        storageKeys: [],
        counts: { runs: 0, attempts: 0, steps: 0, artifacts: 0 },
      };
    }
    const inRuns = placeholders(runIds);
    const attempts = await all<{ id: string }>(
      this.database
        .prepare(
          `SELECT id FROM test_attempts
           WHERE test_run_id IN (${inRuns})`,
        )
        .bind(...runIds),
    );
    const stepCount = await one<{ count: number }>(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM run_steps s
           INNER JOIN test_attempts a ON a.id = s.attempt_id
           WHERE a.test_run_id IN (${inRuns})`,
        )
        .bind(...runIds),
    );
    const artifacts = await all<{ storage_key: string }>(
      this.database
        .prepare(
          `SELECT storage_key FROM run_artifacts
           WHERE run_id IN (${inRuns})
           ORDER BY id ASC`,
        )
        .bind(...runIds),
    );
    return {
      runIds,
      storageKeys: artifacts.map((row) => row.storage_key),
      counts: {
        runs: runIds.length,
        attempts: attempts.length,
        steps: stepCount?.count ?? 0,
        artifacts: artifacts.length,
      },
    };
  }

  async deleteRunBatch(runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    const inRuns = placeholders(runIds);
    await batch(this.database, [
      this.database
        .prepare(
          `DELETE FROM run_steps WHERE attempt_id IN (
             SELECT id FROM test_attempts WHERE test_run_id IN (${inRuns})
           )`,
        )
        .bind(...runIds),
      this.database
        .prepare(`DELETE FROM test_attempts WHERE test_run_id IN (${inRuns})`)
        .bind(...runIds),
      this.database
        .prepare(`DELETE FROM run_artifacts WHERE run_id IN (${inRuns})`)
        .bind(...runIds),
      this.database
        .prepare(`DELETE FROM test_runs WHERE id IN (${inRuns})`)
        .bind(...runIds),
    ]);
  }

  async deleteDeliveriesOlderThan(
    before: number,
    limit: number,
  ): Promise<number> {
    const result = await run(
      this.database
        .prepare(
          `DELETE FROM notification_deliveries WHERE id IN (
             SELECT id FROM notification_deliveries
             WHERE created_at < ? ORDER BY created_at ASC, id ASC LIMIT ?
           )`,
        )
        .bind(before, limit),
    );
    return result.meta.changes;
  }

  async deleteAuthDebris(input: {
    emailBefore: number;
    refreshBefore: number;
    invitationBefore: number;
    limit: number;
  }): Promise<AuthDebrisCounts> {
    const [emailTokens, refreshTokens, invitations] = await batch(
      this.database,
      [
        this.database
          .prepare(
            `DELETE FROM email_tokens WHERE id IN (
               SELECT id FROM email_tokens WHERE expires_at < ?
               ORDER BY expires_at ASC, id ASC LIMIT ?
             )`,
          )
          .bind(input.emailBefore, input.limit),
        this.database
          .prepare(
            `DELETE FROM refresh_tokens WHERE id IN (
               SELECT id FROM refresh_tokens
               WHERE expires_at < ?
                  OR (revoked_at IS NOT NULL AND revoked_at < ?)
               ORDER BY COALESCE(revoked_at, expires_at) ASC, id ASC LIMIT ?
             )`,
          )
          .bind(input.refreshBefore, input.refreshBefore, input.limit),
        this.database
          .prepare(
            `DELETE FROM workspace_invitations WHERE id IN (
               SELECT id FROM workspace_invitations WHERE expires_at < ?
               ORDER BY expires_at ASC, id ASC LIMIT ?
             )`,
          )
          .bind(input.invitationBefore, input.limit),
      ],
    );
    return {
      emailTokens: emailTokens?.meta.changes ?? 0,
      refreshTokens: refreshTokens?.meta.changes ?? 0,
      invitations: invitations?.meta.changes ?? 0,
    };
  }

  async purgeDeletedWorkspaceOperational(
    before: number,
    limit: number,
  ): Promise<DeletedWorkspacePurgeCounts> {
    const rows = await all<{ id: string }>(
      this.database
        .prepare(
          `SELECT w.id FROM workspaces w
           WHERE w.deleted_at IS NOT NULL AND w.deleted_at < ?
             AND (
               EXISTS (SELECT 1 FROM workspace_secrets s WHERE s.workspace_id = w.id)
               OR EXISTS (SELECT 1 FROM notification_channels c WHERE c.workspace_id = w.id)
               OR EXISTS (SELECT 1 FROM browser_tests b WHERE b.workspace_id = w.id)
               OR EXISTS (SELECT 1 FROM uptime_monitors u WHERE u.workspace_id = w.id)
               OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id)
               OR EXISTS (SELECT 1 FROM workspace_invitations i WHERE i.workspace_id = w.id)
             )
           ORDER BY w.deleted_at ASC, w.id ASC LIMIT ?`,
        )
        .bind(before, limit),
    );
    const workspaceIds = rows.map((row) => row.id);
    if (workspaceIds.length === 0) {
      return { workspaces: 0, invitations: 0 };
    }
    const inWorkspaces = placeholders(workspaceIds);
    const invitationCount = await one<{ count: number }>(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM workspace_invitations
           WHERE workspace_id IN (${inWorkspaces})`,
        )
        .bind(...workspaceIds),
    );
    await batch(this.database, [
      this.database
        .prepare(
          `DELETE FROM browser_test_channels
           WHERE browser_test_id IN (
             SELECT id FROM browser_tests WHERE workspace_id IN (${inWorkspaces})
           ) OR notification_channel_id IN (
             SELECT id FROM notification_channels WHERE workspace_id IN (${inWorkspaces})
           )`,
        )
        .bind(...workspaceIds, ...workspaceIds),
      this.database
        .prepare(
          `DELETE FROM uptime_monitor_channels
           WHERE uptime_monitor_id IN (
             SELECT id FROM uptime_monitors WHERE workspace_id IN (${inWorkspaces})
           ) OR notification_channel_id IN (
             SELECT id FROM notification_channels WHERE workspace_id IN (${inWorkspaces})
           )`,
        )
        .bind(...workspaceIds, ...workspaceIds),
      this.database
        .prepare(`DELETE FROM workspace_secrets WHERE workspace_id IN (${inWorkspaces})`)
        .bind(...workspaceIds),
      this.database
        .prepare(`DELETE FROM notification_channels WHERE workspace_id IN (${inWorkspaces})`)
        .bind(...workspaceIds),
      this.database
        .prepare(`DELETE FROM browser_tests WHERE workspace_id IN (${inWorkspaces})`)
        .bind(...workspaceIds),
      this.database
        .prepare(`DELETE FROM uptime_monitors WHERE workspace_id IN (${inWorkspaces})`)
        .bind(...workspaceIds),
      this.database
        .prepare(`DELETE FROM workspace_members WHERE workspace_id IN (${inWorkspaces})`)
        .bind(...workspaceIds),
      this.database
        .prepare(`DELETE FROM workspace_invitations WHERE workspace_id IN (${inWorkspaces})`)
        .bind(...workspaceIds),
    ]);
    return {
      workspaces: workspaceIds.length,
      invitations: invitationCount?.count ?? 0,
    };
  }
}
