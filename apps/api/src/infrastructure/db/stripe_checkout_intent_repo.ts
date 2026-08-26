import type {
  CheckoutIntentRepo,
  ConsumeCheckoutIntentResult,
} from "../../domain/billing/repo";
import type { CheckoutIntent } from "../../domain/billing/types";
import { one, run } from "./d1";

interface IntentRow {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  purpose: CheckoutIntent["purpose"];
  product_id: string;
  price_id: string;
  quantity: number;
  currency_code: "EUR";
  amount_cents: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  provider_reference: string | null;
}

function toIntent(row: IntentRow): CheckoutIntent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    purpose: row.purpose,
    productId: row.product_id,
    priceId: row.price_id,
    quantity: row.quantity,
    currencyCode: row.currency_code,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    providerReference: row.provider_reference,
  };
}

export class D1StripeCheckoutIntentRepo implements CheckoutIntentRepo {
  constructor(private readonly database: D1Database) {}

  async insert(intent: CheckoutIntent): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO stripe_checkout_intents
            (id, workspace_id, actor_user_id, purpose, product_id, price_id,
             quantity, currency_code, amount_cents, created_at, expires_at,
             consumed_at, provider_reference)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          intent.id,
          intent.workspaceId,
          intent.actorUserId,
          intent.purpose,
          intent.productId,
          intent.priceId,
          intent.quantity,
          intent.currencyCode,
          intent.amountCents,
          intent.createdAt,
          intent.expiresAt,
          intent.consumedAt,
          intent.providerReference,
        ),
    );
  }

  async findById(id: string): Promise<CheckoutIntent | null> {
    const row = await one<IntentRow>(
      this.database
        .prepare("SELECT * FROM stripe_checkout_intents WHERE id = ?")
        .bind(id),
    );
    return row === null ? null : toIntent(row);
  }

  async consume(
    id: string,
    providerReference: string,
    at: number,
  ): Promise<ConsumeCheckoutIntentResult> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE stripe_checkout_intents
           SET consumed_at = ?, provider_reference = ?
           WHERE id = ? AND consumed_at IS NULL AND expires_at >= ?`,
        )
        .bind(at, providerReference, id, at),
    );
    if ((result.meta.changes ?? 0) === 1) return "consumed";
    const current = await this.findById(id);
    return current?.providerReference === providerReference
      ? "replayed"
      : "unavailable";
  }

  async purgeExpired(before: number): Promise<number> {
    const result = await run(
      this.database
        .prepare(
          `DELETE FROM stripe_checkout_intents
           WHERE expires_at < ? AND (consumed_at IS NULL OR consumed_at < ?)`,
        )
        .bind(before, before),
    );
    return result.meta.changes ?? 0;
  }
}
