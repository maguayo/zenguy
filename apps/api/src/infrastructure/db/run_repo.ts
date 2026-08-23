import type {
  RunFinalize,
  RunIncidentOrder,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type {
  RunSnapshot,
  RunSource,
  RunStatus,
  RunSummaryRow,
  RunTick,
  TestAttempt,
  TestRun,
  IrreversibleActionRequest,
  ActionAuthorizationState,
} from "../../domain/browser_tests/types";
import {
  actionMatchesScope,
  validActionAuthorizationState,
} from "../../domain/browser_tests/irreversible_authorization";
import type { Cursor } from "../../shared/pagination";
import { all, batch, one, run } from "./d1";

interface RunRow {
  id: string;
  workspace_id: string;
  browser_test_id: string | null;
  source: RunSource;
  status: RunStatus;
  snapshot_json: string;
  action_authorizations_json: string;
  scheduled_for: number | null;
  queued_at: number;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  attempt_count: number;
  infra_attempts: number;
  passed_after_retry: number;
  billable: number;
  usage_event_id: string | null;
  triggered_by_user_id: string | null;
  incident_id: string | null;
  created_at: number;
}

const MAX_IDS_PER_QUERY = 90;

function toRun(row: RunRow): TestRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    browserTestId: row.browser_test_id,
    source: row.source,
    status: row.status,
    snapshot: JSON.parse(row.snapshot_json) as RunSnapshot,
    actionAuthorizations: parseActionAuthorizations(
      row.action_authorizations_json,
    ),
    scheduledFor: row.scheduled_for,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    attemptCount: row.attempt_count,
    infraAttempts: row.infra_attempts,
    passedAfterRetry: row.passed_after_retry === 1,
    billable: row.billable === 1,
    usageEventId: row.usage_event_id,
    triggeredByUserId: row.triggered_by_user_id,
    incidentId: row.incident_id,
    createdAt: row.created_at,
  };
}

function parseActionAuthorizations(raw: string): ActionAuthorizationState[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 20) return [];
    if (
      !parsed.every(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          Number.isInteger((entry as { remainingUses?: unknown }).remainingUses) &&
          Number((entry as { remainingUses: number }).remainingUses) >= 0 &&
          typeof (entry as { scope?: unknown }).scope === "object" &&
          (entry as { scope?: unknown }).scope !== null,
      )
    ) {
      return [];
    }
    return parsed as ActionAuthorizationState[];
  } catch {
    return [];
  }
}

export class D1RunRepo implements RunRepo {
  constructor(private readonly database: D1Database) {}

  async insert(value: TestRun): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO test_runs
            (id, workspace_id, browser_test_id, source, status, snapshot_json,
             action_authorizations_json,
             scheduled_for, queued_at, started_at, finished_at, duration_ms,
             attempt_count, infra_attempts, passed_after_retry, billable,
             usage_event_id, triggered_by_user_id, incident_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          value.id,
          value.workspaceId,
          value.browserTestId,
          value.source,
          value.status,
          JSON.stringify(value.snapshot),
          JSON.stringify(value.actionAuthorizations ?? []),
          value.scheduledFor,
          value.queuedAt,
          value.startedAt,
          value.finishedAt,
          value.durationMs,
          value.attemptCount,
          value.infraAttempts,
          value.passedAfterRetry ? 1 : 0,
          value.billable ? 1 : 0,
          value.usageEventId,
          value.triggeredByUserId,
          value.incidentId,
          value.createdAt,
        ),
    );
  }

  async insertWithAttempt(
    value: TestRun,
    attempt: TestAttempt,
  ): Promise<void> {
    await batch(this.database, [
      this.database
        .prepare(
          `INSERT INTO test_runs
            (id, workspace_id, browser_test_id, source, status, snapshot_json,
             action_authorizations_json,
             scheduled_for, queued_at, started_at, finished_at, duration_ms,
             attempt_count, infra_attempts, passed_after_retry, billable,
             usage_event_id, triggered_by_user_id, incident_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          value.id,
          value.workspaceId,
          value.browserTestId,
          value.source,
          value.status,
          JSON.stringify(value.snapshot),
          JSON.stringify(value.actionAuthorizations ?? []),
          value.scheduledFor,
          value.queuedAt,
          value.startedAt,
          value.finishedAt,
          value.durationMs,
          value.attemptCount,
          value.infraAttempts,
          value.passedAfterRetry ? 1 : 0,
          value.billable ? 1 : 0,
          value.usageEventId,
          value.triggeredByUserId,
          value.incidentId,
          value.createdAt,
        ),
      this.database
        .prepare(
          `INSERT INTO test_attempts
            (id, test_run_id, attempt_index, status, retry_delay_seconds,
             queued_at, started_at, finished_at, duration_ms, summary,
             expected_result, actual_result, failure_reason, visited_urls_json,
             console_errors_json, network_errors_json, token_usage, model_name,
             runner_version, system_error_code, created_at,
             input_tokens, output_tokens, runner_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attempt.id,
          attempt.testRunId,
          attempt.attemptIndex,
          attempt.status,
          attempt.retryDelaySeconds,
          attempt.queuedAt,
          attempt.startedAt,
          attempt.finishedAt,
          attempt.durationMs,
          attempt.summary,
          attempt.expectedResult,
          attempt.actualResult,
          attempt.failureReason,
          attempt.visitedUrlsJson,
          attempt.consoleErrorsJson,
          attempt.networkErrorsJson,
          attempt.tokenUsage,
          attempt.modelName,
          attempt.runnerVersion,
          attempt.systemErrorCode,
          attempt.createdAt,
          attempt.inputTokens,
          attempt.outputTokens,
          attempt.runnerKind,
        ),
    ]);
  }

  async findById(
    workspaceId: string,
    runId: string,
  ): Promise<TestRun | null> {
    const row = await one<RunRow>(
      this.database
        .prepare(
          "SELECT * FROM test_runs WHERE workspace_id = ? AND id = ?",
        )
        .bind(workspaceId, runId),
    );
    return row === null ? null : toRun(row);
  }

  async consumeActionAuthorization(
    runId: string,
    action: IrreversibleActionRequest,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const row = await one<{
        status: RunStatus;
        snapshot_json: string;
        action_authorizations_json: string;
      }>(
        this.database
          .prepare(
            `SELECT status, snapshot_json, action_authorizations_json FROM test_runs
             WHERE id = ?`,
          )
          .bind(runId),
      );
      if (row === null || row.status !== "RUNNING") return false;
      const state = parseActionAuthorizations(row.action_authorizations_json);
      let snapshot: RunSnapshot;
      try {
        snapshot = JSON.parse(row.snapshot_json) as RunSnapshot;
      } catch {
        return false;
      }
      if (!validActionAuthorizationState(snapshot, state)) return false;
      const index = state.findIndex(
        (entry) =>
          entry.remainingUses > 0 && actionMatchesScope(action, entry.scope),
      );
      if (index < 0) return false;
      const next = structuredClone(state);
      const current = next[index];
      if (current === undefined) return false;
      next[index] = {
        scope: current.scope,
        remainingUses: current.remainingUses - 1,
      };
      const result = await run(
        this.database
          .prepare(
            `UPDATE test_runs SET action_authorizations_json = ?
             WHERE id = ? AND status = 'RUNNING'
               AND action_authorizations_json = ?`,
          )
          .bind(
            JSON.stringify(next),
            runId,
            row.action_authorizations_json,
          ),
      );
      if (result.meta.changes === 1) return true;
    }
    return false;
  }

  async findByIdForExecution(runId: string): Promise<TestRun | null> {
    const row = await one<RunRow>(
      this.database.prepare("SELECT * FROM test_runs WHERE id = ?").bind(runId),
    );
    return row === null ? null : toRun(row);
  }

  async listForTest(
    testId: string,
    cursor: Cursor | null | undefined,
    limit: number,
    statusFilter?: RunStatus,
  ): Promise<TestRun[]> {
    const clauses = ["browser_test_id = ?"];
    const values: (string | number)[] = [testId];
    if (statusFilter !== undefined) {
      clauses.push("status = ?");
      values.push(statusFilter);
    }
    if (cursor !== null && cursor !== undefined) {
      clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    values.push(limit);
    const rows = await all<RunRow>(
      this.database
        .prepare(
          `SELECT * FROM test_runs WHERE ${clauses.join(" AND ")}
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(...values),
    );
    return rows.map(toRun);
  }

  async updateStatus(
    runId: string,
    status: RunStatus,
    startedAt?: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE test_runs
           SET status = ?, started_at = COALESCE(started_at, ?)
           WHERE id = ?`,
        )
        .bind(status, startedAt ?? null, runId),
    );
  }

  async finalize(runId: string, changes: RunFinalize): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE test_runs
           SET status = ?, finished_at = ?, duration_ms = ?, attempt_count = ?,
               passed_after_retry = ?, billable = ?,
               incident_id = CASE WHEN ? = 1 THEN ? ELSE incident_id END
           WHERE id = ?`,
        )
        .bind(
          changes.status,
          changes.finishedAt,
          changes.durationMs,
          changes.attemptCount,
          changes.passedAfterRetry ? 1 : 0,
          changes.billable ? 1 : 0,
          changes.incidentId === undefined ? 0 : 1,
          changes.incidentId ?? null,
          runId,
        ),
    );
  }

  async setAttemptCount(runId: string, attemptCount: number): Promise<void> {
    await run(
      this.database
        .prepare("UPDATE test_runs SET attempt_count = ? WHERE id = ?")
        .bind(attemptCount, runId),
    );
  }

  async setUsageEventId(runId: string, usageEventId: string): Promise<void> {
    await run(
      this.database
        .prepare("UPDATE test_runs SET usage_event_id = ? WHERE id = ?")
        .bind(usageEventId, runId),
    );
  }

  async setIncidentId(
    runId: string,
    incidentId: string | null,
  ): Promise<void> {
    await run(
      this.database
        .prepare("UPDATE test_runs SET incident_id = ? WHERE id = ?")
        .bind(incidentId, runId),
    );
  }

  async hasLaterIncidentResult(order: RunIncidentOrder): Promise<boolean> {
    const row = await one<{ present: number }>(
      this.database
        .prepare(
          `SELECT 1 AS present
           FROM test_runs
           WHERE browser_test_id = ?
             AND source != 'VALIDATION'
             AND status IN ('PASSED', 'FAILED', 'TIMEOUT')
             AND finished_at IS NOT NULL
             AND (
               finished_at > ?
               OR (finished_at = ? AND created_at > ?)
               OR (finished_at = ? AND created_at = ? AND id > ?)
             )
           LIMIT 1`,
        )
        .bind(
          order.browserTestId,
          order.finishedAt,
          order.finishedAt,
          order.createdAt,
          order.finishedAt,
          order.createdAt,
          order.runId,
        ),
    );
    return row !== null;
  }

  async incrementInfraAttempts(runId: string): Promise<number> {
    const row = await one<{ infra_attempts: number }>(
      this.database
        .prepare(
          `UPDATE test_runs SET infra_attempts = infra_attempts + 1
           WHERE id = ? RETURNING infra_attempts`,
        )
        .bind(runId),
    );
    return row?.infra_attempts ?? 0;
  }

  async recentRunsPerTest(
    workspaceId: string,
    limit: number,
    testIds?: string[],
  ): Promise<Map<string, RunTick[]>> {
    const uniqueTestIds = testIds === undefined ? undefined : [...new Set(testIds)];
    if (uniqueTestIds?.length === 0) return new Map();
    const chunks: Array<string[] | undefined> =
      uniqueTestIds === undefined
        ? [undefined]
        : Array.from(
            { length: Math.ceil(uniqueTestIds.length / MAX_IDS_PER_QUERY) },
            (_, index) =>
              uniqueTestIds.slice(
                index * MAX_IDS_PER_QUERY,
                (index + 1) * MAX_IDS_PER_QUERY,
              ),
          );
    const rows = (
      await Promise.all(
        chunks.map(async (chunk) => {
          const testFilter =
            chunk === undefined
              ? ""
              : `AND browser_test_id IN (${chunk.map(() => "?").join(", ")})`;
          return all<
            Pick<RunRow, "browser_test_id" | "id" | "status" | "finished_at">
          >(
            this.database
              .prepare(
                `SELECT browser_test_id, id, status, finished_at
                 FROM (
                   SELECT browser_test_id, id, status, finished_at,
                          ROW_NUMBER() OVER (
                            PARTITION BY browser_test_id
                            ORDER BY created_at DESC, id DESC
                          ) AS row_number
                   FROM test_runs
                   WHERE workspace_id = ? AND browser_test_id IS NOT NULL
                     ${testFilter}
                 ) WHERE row_number <= ?
                 ORDER BY browser_test_id, row_number DESC`,
              )
              .bind(workspaceId, ...(chunk ?? []), limit),
          );
        }),
      )
    ).flat();
    const ticks = new Map<string, RunTick[]>();
    for (const row of rows) {
      if (row.browser_test_id === null) continue;
      const list = ticks.get(row.browser_test_id) ?? [];
      list.push({ id: row.id, status: row.status, finishedAt: row.finished_at });
      ticks.set(row.browser_test_id, list);
    }
    return ticks;
  }

  async lastRunSummaryPerTest(
    workspaceId: string,
    testIds?: string[],
  ): Promise<Map<string, RunSummaryRow>> {
    const uniqueTestIds = testIds === undefined ? undefined : [...new Set(testIds)];
    if (uniqueTestIds?.length === 0) return new Map();
    const chunks: Array<string[] | undefined> =
      uniqueTestIds === undefined
        ? [undefined]
        : Array.from(
            { length: Math.ceil(uniqueTestIds.length / MAX_IDS_PER_QUERY) },
            (_, index) =>
              uniqueTestIds.slice(
                index * MAX_IDS_PER_QUERY,
                (index + 1) * MAX_IDS_PER_QUERY,
              ),
          );
    const rows = (
      await Promise.all(
        chunks.map(async (chunk) => {
          const testFilter =
            chunk === undefined
              ? ""
              : `AND browser_test_id IN (${chunk.map(() => "?").join(", ")})`;
          return all<
            Pick<
              RunRow,
              | "browser_test_id"
              | "id"
              | "source"
              | "status"
              | "started_at"
              | "finished_at"
              | "duration_ms"
              | "attempt_count"
              | "passed_after_retry"
              | "billable"
              | "created_at"
            >
          >(
            this.database
              .prepare(
                `SELECT browser_test_id, id, source, status, started_at,
                        finished_at, duration_ms, attempt_count,
                        passed_after_retry, billable, created_at
                 FROM (
                   SELECT *, ROW_NUMBER() OVER (
                     PARTITION BY browser_test_id
                     ORDER BY created_at DESC, id DESC
                   ) AS row_number
                   FROM test_runs
                   WHERE workspace_id = ? AND browser_test_id IS NOT NULL
                     AND finished_at IS NOT NULL
                     ${testFilter}
                 ) WHERE row_number = 1`,
              )
              .bind(workspaceId, ...(chunk ?? [])),
          );
        }),
      )
    ).flat();
    const summaries = new Map<string, RunSummaryRow>();
    for (const row of rows) {
      if (row.browser_test_id === null) continue;
      summaries.set(row.browser_test_id, {
        browserTestId: row.browser_test_id,
        id: row.id,
        source: row.source,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs: row.duration_ms,
        attemptCount: row.attempt_count,
        passedAfterRetry: row.passed_after_retry === 1,
        billable: row.billable === 1,
        createdAt: row.created_at,
      });
    }
    return summaries;
  }

  async activeRunExists(testId: string): Promise<boolean> {
    return (
      (await one<{ found: number }>(
        this.database
          .prepare(
            `SELECT 1 AS found FROM test_runs
             WHERE browser_test_id = ? AND status IN ('QUEUED', 'RUNNING')
             LIMIT 1`,
          )
          .bind(testId),
      )) !== null
    );
  }

  async scheduledOccurrenceExists(
    testId: string,
    scheduledFor: number,
  ): Promise<boolean> {
    return (
      (await one<{ found: number }>(
        this.database
          .prepare(
            `SELECT 1 AS found FROM test_runs
             WHERE browser_test_id = ? AND scheduled_for = ? LIMIT 1`,
          )
          .bind(testId, scheduledFor),
      )) !== null
    );
  }

  async countRunning(workspaceId: string): Promise<number> {
    const row = await one<{ count: number }>(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM test_runs
           WHERE workspace_id = ? AND status = 'RUNNING'`,
        )
        .bind(workspaceId),
    );
    return row?.count ?? 0;
  }
}
