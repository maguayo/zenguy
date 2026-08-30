import type { OverageReportRepo } from "../../domain/billing/repo";
import type { OverageReport } from "../../domain/billing/types";
import { isUniqueConstraintError, one, run } from "./d1";

interface OverageReportRow {
  id: string;
  workspace_id: string;
  period_start: number;
  period_end: number;
  overage_runs: number;
  amount_cents: number;
  paddle_transaction_id: string | null;
  reported_at: number;
  state: OverageReport["state"];
  provider_marker: string | null;
  attempt_started_at: number | null;
  completed_at: number | null;
  provider_subscription_id: string | null;
  currency_code: string | null;
}

function toOverageReport(row: OverageReportRow): OverageReport {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    overageRuns: row.overage_runs,
    amountCents: row.amount_cents,
    paddleTransactionId: row.paddle_transaction_id,
    reportedAt: row.reported_at,
    state: row.state,
    providerMarker: row.provider_marker,
    attemptStartedAt: row.attempt_started_at,
    completedAt: row.completed_at,
    providerSubscriptionId: row.provider_subscription_id,
    currencyCode: row.currency_code === "USD" ? "USD" : "EUR",
  };
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
               amount_cents, paddle_transaction_id, reported_at, state,
               provider_marker, attempt_started_at, completed_at,
               provider_subscription_id, currency_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            report.state,
            report.providerMarker,
            report.attemptStartedAt,
            report.completedAt,
            report.providerSubscriptionId,
            report.currencyCode ?? "EUR",
          ),
      );
      return "inserted";
    } catch (error) {
      if (isUniqueConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async findFor(
    workspaceId: string,
    periodStart: number,
  ): Promise<OverageReport | null> {
    const row = await one<OverageReportRow>(
      this.database
        .prepare(
          `SELECT * FROM overage_reports
           WHERE workspace_id = ? AND period_start = ?`,
        )
        .bind(workspaceId, periodStart),
    );
    return row === null ? null : toOverageReport(row);
  }

  async beginAttempt(
    id: string,
    at: number,
  ): Promise<boolean> {
    const statement = this.database
      .prepare(
        `UPDATE overage_reports
         SET state = 'AMBIGUOUS', attempt_started_at = ?
         WHERE id = ? AND state = 'PENDING'
           AND attempt_started_at IS NULL`,
      )
      .bind(at, id);
    const result = await run(statement);
    return result.meta.changes === 1;
  }

  async markCompleted(
    id: string,
    transactionId: string | null,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE overage_reports
           SET state = 'COMPLETED', paddle_transaction_id = ?, completed_at = ?
           WHERE id = ?`,
        )
        .bind(transactionId, at, id),
    );
  }
}
