import type { UsageEventRepo } from "../../domain/billing/repo";
import type { UsageEvent } from "../../domain/billing/types";
import { isUniqueConstraintError, one, run } from "./d1";

interface TotalRow {
  total: number;
}

export class D1UsageEventRepo implements UsageEventRepo {
  constructor(private readonly database: D1Database) {}

  async insertIfAbsent(
    event: UsageEvent,
  ): Promise<"inserted" | "duplicate"> {
    try {
      await run(
        this.database
          .prepare(
            `INSERT INTO usage_events
              (id, workspace_id, test_run_id, type, quantity, billable,
               idempotency_key, occurred_at, reversed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            event.id,
            event.workspaceId,
            event.testRunId,
            event.type,
            event.quantity,
            event.billable ? 1 : 0,
            event.idempotencyKey,
            event.occurredAt,
            event.reversedAt,
            event.createdAt,
          ),
      );
      return "inserted";
    } catch (error) {
      if (isUniqueConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async reverseByRunId(runId: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE usage_events
           SET reversed_at = ?
           WHERE test_run_id = ? AND reversed_at IS NULL`,
        )
        .bind(at, runId),
    );
  }

  async countBillable(
    workspaceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<number> {
    const row = await one<TotalRow>(
      this.database
        .prepare(
          `SELECT COALESCE(SUM(quantity), 0) AS total
           FROM usage_events
           WHERE workspace_id = ?
             AND billable = 1
             AND reversed_at IS NULL
             AND occurred_at >= ?
             AND occurred_at < ?`,
        )
        .bind(workspaceId, fromMs, toMs),
    );
    return row?.total ?? 0;
  }
}
