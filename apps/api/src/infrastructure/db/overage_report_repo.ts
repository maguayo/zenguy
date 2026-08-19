import type { OverageReportRepo } from "../../domain/billing/repo";
import type { OverageReport } from "../../domain/billing/types";
import { isUniqueConstraintError, one, run } from "./d1";

interface ExistsRow {
  found: number;
}

export class D1OverageReportRepo implements OverageReportRepo {
  constructor(private readonly database: D1Database) {}

  async insertIfAbsent(
    report: OverageReport,
  ): Promise<"inserted" | "duplicate"> {
    try {
      await run(
        this.database
          .prepare(
            `INSERT INTO overage_reports
              (id, workspace_id, period_start, period_end, overage_runs,
               amount_cents, paddle_transaction_id, reported_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            report.id,
            report.workspaceId,
            report.periodStart,
            report.periodEnd,
            report.overageRuns,
            report.amountCents,
            report.paddleTransactionId,
            report.reportedAt,
          ),
      );
      return "inserted";
    } catch (error) {
      if (isUniqueConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async existsFor(
    workspaceId: string,
    periodStart: number,
  ): Promise<boolean> {
    const row = await one<ExistsRow>(
      this.database
        .prepare(
          `SELECT 1 AS found FROM overage_reports
           WHERE workspace_id = ? AND period_start = ?`,
        )
        .bind(workspaceId, periodStart),
    );
    return row !== null;
  }

  async setPaddleTransactionId(
    id: string,
    transactionId: string | null,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE overage_reports SET paddle_transaction_id = ? WHERE id = ?",
        )
        .bind(transactionId, id),
    );
  }

  async deleteById(id: string): Promise<void> {
    await run(
      this.database
        .prepare("DELETE FROM overage_reports WHERE id = ?")
        .bind(id),
    );
  }
}
