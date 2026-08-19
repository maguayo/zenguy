import type { PendingOveragePeriodRepo } from "../../domain/billing/repo";
import type { PendingOveragePeriod } from "../../domain/billing/types";
import { all, isUniqueConstraintError, run } from "./d1";

interface PendingOveragePeriodRow {
  workspace_id: string;
  period_start: number;
  period_end: number;
  created_at: number;
  provider_subscription_id: string | null;
  next_attempt_at: number;
  attempt_count: number;
}

function toPendingOveragePeriod(
  row: PendingOveragePeriodRow,
): PendingOveragePeriod {
  return {
    workspaceId: row.workspace_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    providerSubscriptionId: row.provider_subscription_id,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
  };
}

export class D1PendingOveragePeriodRepo implements PendingOveragePeriodRepo {
  constructor(private readonly database: D1Database) {}

  async insertIfAbsent(
    period: PendingOveragePeriod,
  ): Promise<"inserted" | "duplicate"> {
    try {
      await run(
        this.database
          .prepare(
            `INSERT INTO pending_overage_periods
              (workspace_id, period_start, period_end, created_at,
               provider_subscription_id, next_attempt_at, attempt_count)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            period.workspaceId,
            period.periodStart,
            period.periodEnd,
            period.createdAt,
            period.providerSubscriptionId,
            period.nextAttemptAt,
            period.attemptCount,
          ),
      );
      return "inserted";
    } catch (error) {
      if (isUniqueConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async list(limit: number): Promise<PendingOveragePeriod[]> {
    const rows = await all<PendingOveragePeriodRow>(
      this.database
        .prepare(
          `SELECT * FROM pending_overage_periods
           ORDER BY created_at ASC, workspace_id ASC, period_start ASC
           LIMIT ?`,
        )
        .bind(limit),
    );
    return rows.map(toPendingOveragePeriod);
  }

  async listReady(at: number, limit: number): Promise<PendingOveragePeriod[]> {
    const rows = await all<PendingOveragePeriodRow>(
      this.database
        .prepare(
          `SELECT * FROM pending_overage_periods
           WHERE next_attempt_at <= ?
           ORDER BY next_attempt_at ASC, workspace_id ASC, period_start ASC
           LIMIT ?`,
        )
        .bind(at, limit),
    );
    return rows.map(toPendingOveragePeriod);
  }

  async rescheduleFor(
    workspaceId: string,
    periodStart: number,
    nextAttemptAt: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE pending_overage_periods
           SET next_attempt_at = ?, attempt_count = attempt_count + 1
           WHERE workspace_id = ? AND period_start = ?`,
        )
        .bind(nextAttemptAt, workspaceId, periodStart),
    );
  }

  async deleteFor(workspaceId: string, periodStart: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `DELETE FROM pending_overage_periods
           WHERE workspace_id = ? AND period_start = ?`,
        )
        .bind(workspaceId, periodStart),
    );
  }
}
