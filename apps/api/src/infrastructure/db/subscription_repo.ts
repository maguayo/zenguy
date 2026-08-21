import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { Subscription } from "../../domain/billing/types";
import { all, one, run } from "./d1";

interface SubscriptionRow {
  id: string;
  workspace_id: string;
  provider: string;
  source: string | null;
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
  last_provider_event_at: number | null;
}

function toSubscription(row: SubscriptionRow): Subscription {
  if (row.provider !== "internal" && row.provider !== "paddle") {
    throw new Error("Unsupported billing provider");
  }
  const source =
    row.source === "free" || row.source === "grant"
      ? row.source
      : "paddle";
  const subscription: Subscription = {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    source,
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
  if (row.last_provider_event_at !== null) {
    subscription.lastProviderEventAt = row.last_provider_event_at;
  }
  return subscription;
}

export class D1SubscriptionRepo implements SubscriptionRepo {
  constructor(private readonly database: D1Database) {}

  async upsertByWorkspace(subscription: Subscription): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO subscriptions
            (id, workspace_id, provider, source, provider_customer_id,
             provider_subscription_id, status, period_start, period_end,
             cancel_at_period_end, update_payment_url, cancel_url,
             created_at, updated_at, last_provider_event_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             provider = excluded.provider,
             source = excluded.source,
             provider_customer_id = excluded.provider_customer_id,
             provider_subscription_id = excluded.provider_subscription_id,
             status = excluded.status,
             period_start = excluded.period_start,
             period_end = excluded.period_end,
             cancel_at_period_end = excluded.cancel_at_period_end,
             update_payment_url = excluded.update_payment_url,
             cancel_url = excluded.cancel_url,
             updated_at = excluded.updated_at,
             last_provider_event_at = COALESCE(
               excluded.last_provider_event_at,
               subscriptions.last_provider_event_at
             )
           WHERE subscriptions.last_provider_event_at IS NULL
              OR excluded.last_provider_event_at IS NULL
              OR excluded.last_provider_event_at >= subscriptions.last_provider_event_at`,
        )
        .bind(
          subscription.id,
          subscription.workspaceId,
          subscription.provider,
          subscription.source ??
            (subscription.provider === "internal" ? "free" : "paddle"),
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
          subscription.lastProviderEventAt ?? null,
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
    after?: { periodEnd: number; id: string },
  ): Promise<Subscription[]> {
    const afterPeriodEnd = after?.periodEnd ?? null;
    const afterId = after?.id ?? null;
    const rows = await all<SubscriptionRow>(
      this.database
        .prepare(
          `SELECT s.* FROM subscriptions AS s
           WHERE s.period_end IS NOT NULL AND s.period_end <= ?
             AND (
               ? IS NULL OR s.period_end > ?
               OR (s.period_end = ? AND s.id > ?)
             )
             AND NOT EXISTS (
               SELECT 1 FROM overage_reports AS o
               WHERE o.workspace_id = s.workspace_id
                 AND o.period_start = s.period_start
                 AND o.state = 'COMPLETED'
             )
             AND NOT EXISTS (
               SELECT 1 FROM pending_overage_periods AS p
               WHERE p.workspace_id = s.workspace_id
                 AND p.period_start = s.period_start
             )
           ORDER BY s.period_end ASC, s.id ASC
           LIMIT ?`,
        )
        .bind(
          before,
          afterPeriodEnd,
          afterPeriodEnd,
          afterPeriodEnd,
          afterId,
          limit,
        ),
    );
    return rows.map(toSubscription);
  }
}
