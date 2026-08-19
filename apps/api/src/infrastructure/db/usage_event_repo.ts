import type { UsageEventRepo } from "../../domain/billing/repo";
import type { UsageEvent } from "../../domain/billing/types";
import { isUniqueConstraintError, one, run } from "./d1";

interface TotalRow {
  total: number;
}

interface UsageEventRow {
  id: string;
  workspace_id: string;
  test_run_id: string;
  type: string;
  quantity: number;
  billable: number;
  idempotency_key: string;
  occurred_at: number;
  reversed_at: number | null;
  created_at: number;
}

function toUsageEvent(row: UsageEventRow): UsageEvent {
  if (row.type !== "BROWSER_RUN") {
    throw new Error("Unsupported usage event type");
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    testRunId: row.test_run_id,
    type: "BROWSER_RUN",
    quantity: row.quantity,
    billable: row.billable === 1,
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
    reversedAt: row.reversed_at,
    createdAt: row.created_at,
  };
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

  async findByRunId(runId: string): Promise<UsageEvent | null> {
    const row = await one<UsageEventRow>(
      this.database
        .prepare("SELECT * FROM usage_events WHERE test_run_id = ?")
        .bind(runId),
    );
    return row === null ? null : toUsageEvent(row);
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
