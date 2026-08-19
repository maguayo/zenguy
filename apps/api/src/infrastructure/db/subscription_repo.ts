import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { Subscription } from "../../domain/billing/types";
import { all, one, run } from "./d1";

interface SubscriptionRow {
  id: string;
  workspace_id: string;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  status: Subscription["status"];
  period_start: number | null;
  period_end: number | null;
  cancel_at_period_end: number;
  update_payment_url: string | null;
  cancel_url: string | null;
  created_at: number;
  updated_at: number;
}

function toSubscription(row: SubscriptionRow): Subscription {
  if (row.provider !== "paddle") {
    throw new Error("Unsupported billing provider");
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: "paddle",
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    updatePaymentUrl: row.update_payment_url,
    cancelUrl: row.cancel_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1SubscriptionRepo implements SubscriptionRepo {
  constructor(private readonly database: D1Database) {}

  async upsertByWorkspace(subscription: Subscription): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO subscriptions
            (id, workspace_id, provider, provider_customer_id,
             provider_subscription_id, status, period_start, period_end,
             cancel_at_period_end, update_payment_url, cancel_url,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             provider = excluded.provider,
             provider_customer_id = excluded.provider_customer_id,
             provider_subscription_id = excluded.provider_subscription_id,
             status = excluded.status,
             period_start = excluded.period_start,
             period_end = excluded.period_end,
             cancel_at_period_end = excluded.cancel_at_period_end,
             update_payment_url = excluded.update_payment_url,
             cancel_url = excluded.cancel_url,
             updated_at = excluded.updated_at`,
        )
        .bind(
          subscription.id,
          subscription.workspaceId,
          subscription.provider,
          subscription.providerCustomerId,
          subscription.providerSubscriptionId,
          subscription.status,
          subscription.periodStart,
          subscription.periodEnd,
          subscription.cancelAtPeriodEnd ? 1 : 0,
          subscription.updatePaymentUrl,
          subscription.cancelUrl,
          subscription.createdAt,
          subscription.updatedAt,
        ),
    );
  }

  async findByWorkspace(workspaceId: string): Promise<Subscription | null> {
    const row = await one<SubscriptionRow>(
      this.database
        .prepare("SELECT * FROM subscriptions WHERE workspace_id = ?")
        .bind(workspaceId),
    );
    return row === null ? null : toSubscription(row);
  }

  async findByProviderSubscriptionId(
    id: string,
  ): Promise<Subscription | null> {
    const row = await one<SubscriptionRow>(
      this.database
        .prepare(
          "SELECT * FROM subscriptions WHERE provider_subscription_id = ?",
        )
        .bind(id),
    );
    return row === null ? null : toSubscription(row);
  }

  async listPeriodEnded(
    before: number,
    limit: number,
  ): Promise<Subscription[]> {
    const rows = await all<SubscriptionRow>(
      this.database
        .prepare(
          `SELECT * FROM subscriptions
           WHERE period_end IS NOT NULL AND period_end <= ?
           ORDER BY period_end ASC, id ASC
           LIMIT ?`,
        )
        .bind(before, limit),
    );
    return rows.map(toSubscription);
  }
}
