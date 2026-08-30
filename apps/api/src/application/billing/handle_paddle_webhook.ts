import { z } from "zod";
import type { AlertRepo } from "../../domain/alerts/repo";
import { ALERT_CREDIT_PACK_CENTS } from "../../domain/alerts/types";
import { ALERT_CREDIT_PURPOSE } from "../alerts/start_credit_topup";
import { ensureAlertSettings } from "../alerts/settings";
import type { WriteAudit } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type {
  PaddleCheckoutIntentRepo,
  PendingOveragePeriodRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type {
  BillingCurrency,
  PaddleCheckoutIntent,
  Subscription,
  SubscriptionStatus,
} from "../../domain/billing/types";
import type { Clock } from "../../shared/clock";
import { hmacVerifyHex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import { OVERAGE_SETTLEMENT_DELAY_MS } from "./report_overage_for_period";
import { verifyPaddleIntentReference } from "./paddle_checkout_intent";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import { PLAN_PRICE_CENTS } from "../../shared/constants";
import { toPaddleLedgerAdjustmentAmount } from "./paddle_adjustment";

const SIGNATURE_TOLERANCE_MS = 15 * 60 * 1_000;
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

const envelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.string().min(1),
  data: z.unknown(),
});

const periodSchema = z.object({
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
});

const positiveMoneySchema = z
  .string()
  .regex(/^\d+$/u)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value > 0);
const signedNonZeroMoneySchema = z
  .string()
  .regex(/^-?\d+$/u)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value !== 0);
const catalogItemSchema = z.object({
  price: z.object({
    id: z.string().min(1),
    product_id: z.string().min(1),
    unit_price: z.object({
      amount: positiveMoneySchema,
      currency_code: z.string().length(3),
    }),
  }),
  quantity: z.number().int().positive(),
});

const subscriptionSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  status: z.string().min(1),
  custom_data: z.unknown().optional(),
  items: z.array(catalogItemSchema).min(1),
  current_billing_period: periodSchema.nullable().optional(),
  scheduled_change: z
    .object({ action: z.string().min(1) })
    .nullable()
    .optional(),
});

const transactionSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  currency_code: z.string().length(3),
  status: z.string().min(1),
  custom_data: z.unknown().optional(),
  items: z.array(catalogItemSchema).min(1),
  details: z.object({
    totals: z.object({
      currency_code: z.string().length(3),
      total: positiveMoneySchema,
    }),
  }),
});

const adjustmentSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  status: z.string().min(1),
  transaction_id: z.string().min(1),
  customer_id: z.string().min(1),
  currency_code: z.string().length(3),
  totals: z.object({
    total: signedNonZeroMoneySchema,
    currency_code: z.string().length(3),
  }),
});

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "subscription.past_due",
]);

export interface PeriodOverageReporter {
  execute(input: {
    workspaceId: string;
    periodStart: number;
    periodEnd: number;
    providerSubscriptionId: string;
    currencyCode?: BillingCurrency;
  }): Promise<unknown>;
}

export interface HandlePaddleWebhookDependencies {
  webhookSecret: string;
  kv: KVNamespace;
  subscriptions: SubscriptionRepo;
  checkoutIntents: PaddleCheckoutIntentRepo;
  workspaces: Pick<WorkspaceRepo, "findById">;
  pendingOveragePeriods: PendingOveragePeriodRepo;
  overageReporter: PeriodOverageReporter;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  /** Alert-credit ledger; top-ups are ignored when absent. */
  alerts?: AlertRepo;
  /** Paddle product owning the alert-credit price; top-ups are ignored when null. */
  alertCreditProductId?: string | null;
  /** Paddle price of one alert-credit pack; top-ups are ignored when null. */
  alertCreditPriceId?: string | null;
  subscriptionProductId: string;
  subscriptionPriceId: string;
}

function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "Invalid Paddle signature");
}

function parseSignature(header: string | null): {
  timestamp: number;
  signature: string;
} {
  if (header === null) throw unauthorized();
  const values = new Map<string, string>();
  for (const component of header.split(";")) {
    const separator = component.indexOf("=");
    if (separator <= 0) continue;
    values.set(
      component.slice(0, separator).trim(),
      component.slice(separator + 1).trim(),
    );
  }
  const timestampText = values.get("ts");
  const signature = values.get("h1");
  if (
    timestampText === undefined ||
    signature === undefined ||
    !/^\d+$/u.test(timestampText) ||
    !/^[0-9a-f]{64}$/iu.test(signature)
  ) {
    throw unauthorized();
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw unauthorized();
  }
  return { timestamp, signature };
}

function mapStatus(eventType: string, status: string): SubscriptionStatus {
  if (eventType === "subscription.canceled") return "CANCELED";
  if (eventType === "subscription.past_due") return "PAST_DUE";
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
    case "paused":
      return "CANCELED";
    default:
      throw new Error("Unsupported Paddle subscription status");
  }
}

function parseDate(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid Paddle billing period");
  }
  return timestamp;
}

export class HandlePaddleWebhook {
  constructor(private readonly dependencies: HandlePaddleWebhookDependencies) {}

  private async verifySignature(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<void> {
    const { timestamp, signature } = parseSignature(signatureHeader);
    const timestampMs = timestamp * 1_000;
    const age = this.dependencies.clock.now() - timestampMs;
    if (age > SIGNATURE_TOLERANCE_MS || age < -SIGNATURE_TOLERANCE_MS) {
      throw unauthorized();
    }
    const valid = await hmacVerifyHex(
      this.dependencies.webhookSecret,
      `${timestamp}:${rawBody}`,
      signature,
    );
    if (!valid) throw unauthorized();
  }

  private assertCatalogMatches(
    intent: PaddleCheckoutIntent,
    items: z.infer<typeof catalogItemSchema>[],
    currencyCode: string,
    netTotal?: { amountCents: number; currencyCode: string },
  ): void {
    const item = items[0];
    const extendedAmount =
      item === undefined
        ? Number.NaN
        : item.price.unit_price.amount * item.quantity;
    if (
      items.length !== 1 ||
      item === undefined ||
      item.price.product_id !== intent.productId ||
      item.price.id !== intent.priceId ||
      item.quantity !== intent.quantity ||
      item.price.unit_price.currency_code !== intent.currencyCode ||
      !Number.isSafeInteger(extendedAmount) ||
      extendedAmount !== intent.amountCents ||
      currencyCode !== intent.currencyCode ||
      (netTotal !== undefined &&
        (netTotal.currencyCode !== intent.currencyCode ||
          netTotal.amountCents !== intent.amountCents))
    ) {
      throw new Error("Paddle checkout does not match the server intent");
    }
  }

  private async consumeCheckoutIntent(input: {
    customData: unknown;
    purpose: PaddleCheckoutIntent["purpose"];
    items: z.infer<typeof catalogItemSchema>[];
    currencyCode: string;
    netTotal?: { amountCents: number; currencyCode: string };
    currentCatalog?: { productId: string; priceId: string };
    providerReference: string;
  }): Promise<PaddleCheckoutIntent> {
    const intentId = await verifyPaddleIntentReference(
      this.dependencies.webhookSecret,
      input.customData,
    );
    if (intentId === null) {
      throw new Error("Paddle checkout intent signature is invalid");
    }
    const intent = await this.dependencies.checkoutIntents.findById(intentId);
    if (intent === null || intent.purpose !== input.purpose) {
      throw new Error("Paddle checkout intent is missing");
    }
    if (
      input.currentCatalog !== undefined &&
      (intent.productId !== input.currentCatalog.productId ||
        intent.priceId !== input.currentCatalog.priceId)
    ) {
      throw new Error("Paddle checkout catalog configuration changed");
    }
    this.assertCatalogMatches(
      intent,
      input.items,
      input.currencyCode,
      input.netTotal,
    );
    const workspace = await this.dependencies.workspaces.findById(
      intent.workspaceId,
    );
    if (
      workspace === null ||
      workspace.deletedAt !== null ||
      workspace.ownerUserId !== intent.actorUserId
    ) {
      throw new Error("Paddle checkout owner is no longer authorized");
    }
    const consumed = await this.dependencies.checkoutIntents.consume(
      intent.id,
      input.providerReference,
      this.dependencies.clock.now(),
    );
    if (consumed === "unavailable") {
      throw new Error("Paddle checkout intent is expired or already consumed");
    }
    return intent;
  }

  async execute(input: {
    rawBody: string;
    signatureHeader: string | null;
    ip?: string;
  }): Promise<{ handled: "processed" | "duplicate" | "ignored" }> {
    await this.verifySignature(input.rawBody, input.signatureHeader);

    let decoded: unknown;
    try {
      decoded = JSON.parse(input.rawBody) as unknown;
    } catch {
      throw new Error("Invalid Paddle webhook payload");
    }
    const event = envelopeSchema.parse(decoded);
    const idempotencyKey = `pdl_evt:${event.event_id}`;
    if ((await this.dependencies.kv.get(idempotencyKey)) !== null) {
      return { handled: "duplicate" };
    }

    let handled: "processed" | "ignored" = "ignored";
    if (SUBSCRIPTION_EVENTS.has(event.event_type)) {
      handled = await this.processSubscription(
        event.event_type,
        event.occurred_at,
        event.data,
        input.ip,
      );
    } else if (event.event_type === "transaction.completed") {
      handled = await this.processTransaction(event.data, input.ip);
    } else if (
      event.event_type === "adjustment.created" ||
      event.event_type === "adjustment.updated"
    ) {
      handled = await this.processAdjustment(event.data, input.ip);
    }

    await this.dependencies.kv.put(idempotencyKey, "1", {
      expirationTtl: IDEMPOTENCY_TTL_SECONDS,
    });
    return { handled };
  }

  /**
   * Credits alert-credit packs bought through the one-time checkout. Only
   * transactions tagged with our purpose and containing the configured pack
   * price are credited; the ledger is idempotent on the transaction id.
   */
  private async processTransaction(
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const alerts = this.dependencies.alerts;
    const productId = this.dependencies.alertCreditProductId ?? null;
    const priceId = this.dependencies.alertCreditPriceId ?? null;
    if (alerts === undefined || productId === null || priceId === null) {
      return "ignored";
    }
    const parsed = transactionSchema.safeParse(rawData);
    if (!parsed.success) return "ignored";
    const data = parsed.data;
    if (data.status !== "completed") return "ignored";
    const intentId = await verifyPaddleIntentReference(
      this.dependencies.webhookSecret,
      data.custom_data,
    );
    // Subscription and unrelated completed transactions do not carry an
    // alert-credit intent and are deliberately ignored here.
    if (intentId === null) return "ignored";
    const intent = await this.consumeCheckoutIntent({
      customData: data.custom_data,
      purpose: ALERT_CREDIT_PURPOSE,
      items: data.items,
      currencyCode: data.currency_code,
      netTotal: {
        amountCents: data.details.totals.total,
        currencyCode: data.details.totals.currency_code,
      },
      currentCatalog: { productId, priceId },
      providerReference: data.id,
    });
    const packs = intent.quantity;
    const workspaceId = intent.workspaceId;
    const now = this.dependencies.clock.now();
    const amountCents = intent.amountCents;
    const written = await alerts.credit({
      id: this.dependencies.ids.newId("ace"),
      workspaceId,
      amountCents,
      kind: "TOPUP",
      idempotencyKey: `paddle_txn:${data.id}`,
      description: `Top-up (${packs} × €${ALERT_CREDIT_PACK_CENTS / 100})`,
      deliveryId: null,
      providerTransactionId: data.id,
      providerCustomerId: data.customer_id,
      at: now,
    });
    if (!written.created) return "processed";
    await ensureAlertSettings(alerts, workspaceId, now);
    await alerts.updateSettings(workspaceId, { lowBalanceNotifiedAt: null }, now);
    await this.dependencies.audit.execute({
      workspaceId,
      actorUserId: null,
      action: AUDIT_ACTIONS.alertsCreditTopup,
      resourceType: "alert_credit",
      resourceId: data.id,
      metadata: { amountCents, packs },
      ip,
    });
    return "processed";
  }

  private async processAdjustment(
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const alerts = this.dependencies.alerts;
    if (alerts === undefined) return "ignored";
    const parsed = adjustmentSchema.safeParse(rawData);
    if (!parsed.success) return "ignored";
    const data = parsed.data;
    if (data.status !== "approved") return "ignored";
    const adjustedAmount = toPaddleLedgerAdjustmentAmount(
      data.action,
      data.totals.total,
    );
    const topup = await alerts.findTopupByProviderTransactionId(
      data.transaction_id,
    );
    if (topup === null) return "ignored";
    if (
      topup.providerCustomerId === null ||
      data.customer_id !== topup.providerCustomerId
    ) {
      throw new Error(
        "Paddle adjustment customer does not match credited transaction",
      );
    }
    if (
      data.currency_code !== "EUR" ||
      data.totals.currency_code !== "EUR"
    ) {
      throw new Error("Paddle adjustment amount or currency mismatch");
    }
    const written = await alerts.adjust({
      id: this.dependencies.ids.newId("ace"),
      workspaceId: topup.workspaceId,
      amountCents: adjustedAmount,
      idempotencyKey: `paddle_adjustment:${data.id}:approved`,
      description: `Paddle ${data.action} (${data.id})`,
      providerTransactionId: data.transaction_id,
      at: this.dependencies.clock.now(),
    });
    if (written === null) {
      throw new Error("Paddle adjustment exceeds credited transaction");
    }
    if (written.created) {
      await this.dependencies.audit.execute({
        workspaceId: topup.workspaceId,
        actorUserId: null,
        action: AUDIT_ACTIONS.alertsCreditAdjusted,
        resourceType: "alert_credit",
        resourceId: data.id,
        metadata: {
          action: data.action,
          amountCents: adjustedAmount,
          transactionId: data.transaction_id,
        },
        ip,
      });
    }
    return "processed";
  }

  private async processSubscription(
    eventType: string,
    occurredAtText: string,
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const data = subscriptionSchema.parse(rawData);
    const subscriptionCatalogIntent: PaddleCheckoutIntent = {
      id: "catalog-check",
      workspaceId: "catalog-check",
      actorUserId: "catalog-check",
      purpose: "subscription",
      productId: this.dependencies.subscriptionProductId,
      priceId: this.dependencies.subscriptionPriceId,
      quantity: 1,
      currencyCode: "EUR",
      amountCents: PLAN_PRICE_CENTS,
      createdAt: 0,
      expiresAt: 0,
      consumedAt: null,
      providerReference: null,
    };
    this.assertCatalogMatches(
      subscriptionCatalogIntent,
      data.items,
      data.items[0]?.price.unit_price.currency_code ?? "",
    );
    const byProvider =
      await this.dependencies.subscriptions.findByProviderSubscriptionId(
        data.id,
      );
    let workspaceId: string;
    if (eventType === "subscription.created") {
      const intent = await this.consumeCheckoutIntent({
        customData: data.custom_data,
        purpose: "subscription",
        items: data.items,
        currencyCode: data.items[0]?.price.unit_price.currency_code ?? "",
        providerReference: data.id,
      });
      workspaceId = intent.workspaceId;
      if (byProvider !== null && byProvider.workspaceId !== workspaceId) {
        throw new Error("Paddle subscription is already bound to another workspace");
      }
    } else {
      if (byProvider === null) {
        throw new Error("Paddle subscription workspace missing");
      }
      workspaceId = byProvider.workspaceId;
      if (
        byProvider.providerCustomerId !== null &&
        byProvider.providerCustomerId !== data.customer_id
      ) {
        throw new Error("Paddle customer does not match the subscription owner");
      }
    }
    const stored =
      byProvider ??
      (await this.dependencies.subscriptions.findByWorkspace(workspaceId));
    if (
      stored?.providerSubscriptionId !== null &&
      stored?.providerSubscriptionId !== undefined &&
      stored.providerSubscriptionId !== data.id
    ) {
      throw new Error("Workspace already has a different Paddle subscription");
    }
    if (
      stored?.providerCustomerId !== null &&
      stored?.providerCustomerId !== undefined &&
      stored.provider === "paddle" &&
      stored.providerCustomerId !== data.customer_id
    ) {
      throw new Error("Workspace already belongs to a different Paddle customer");
    }
    const providerEventAt = parseDate(occurredAtText);
    if (
      stored?.lastProviderEventAt !== null &&
      stored?.lastProviderEventAt !== undefined &&
      providerEventAt < stored.lastProviderEventAt
    ) {
      logEvent("paddle_subscription_event_stale", { workspaceId });
      return "ignored";
    }

    const periodStart =
      data.current_billing_period === null ||
      data.current_billing_period === undefined
        ? null
        : parseDate(data.current_billing_period.starts_at);
    const periodEnd =
      data.current_billing_period === null ||
      data.current_billing_period === undefined
        ? null
        : parseDate(data.current_billing_period.ends_at);
    const now = this.dependencies.clock.now();

    if (
      stored?.periodStart !== null &&
      stored?.periodStart !== undefined &&
      stored.periodStart !== periodStart &&
      stored.periodEnd !== null &&
      stored.providerSubscriptionId !== null
    ) {
      await this.dependencies.pendingOveragePeriods.insertIfAbsent({
        workspaceId,
        periodStart: stored.periodStart,
        periodEnd: stored.periodEnd,
        providerSubscriptionId: stored.providerSubscriptionId,
        createdAt: now,
        nextAttemptAt: stored.periodEnd + OVERAGE_SETTLEMENT_DELAY_MS,
        attemptCount: 0,
      });
      try {
        await this.dependencies.overageReporter.execute({
          workspaceId,
          periodStart: stored.periodStart,
          periodEnd: stored.periodEnd,
          providerSubscriptionId: stored.providerSubscriptionId,
        });
      } catch {
        logEvent("overage_rollover_failed", { workspaceId });
      }
      // Keep the durable marker after the immediate attempt. The hourly sweep
      // clears it after the reporter has settled, so a concurrent duplicate
      // webhook cannot erase the only retry marker while this attempt fails.
    }

    const status = mapStatus(eventType, data.status);
    const subscription: Subscription = {
      id: stored?.id ?? this.dependencies.ids.newId("sub"),
      workspaceId,
      provider: "paddle",
      source: "paddle",
      providerCustomerId: data.customer_id,
      providerSubscriptionId: data.id,
      status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: data.scheduled_change?.action === "cancel",
      // DEVIATION: current Paddle webhook payloads do not include the
      // short-lived management_urls. GetBilling fetches fresh URLs from the
      // subscription endpoint only for callers with billing.manage.
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: stored?.createdAt ?? now,
      updatedAt: now,
      pastDueSince:
        status === "PAST_DUE"
          ? stored?.status === "PAST_DUE"
            ? (stored.pastDueSince ?? stored.updatedAt)
            : now
          : null,
      lastProviderEventAt: providerEventAt,
    };
    await this.dependencies.subscriptions.upsertByWorkspace(subscription);
    await this.dependencies.audit.execute({
      workspaceId,
      actorUserId: null,
      action: AUDIT_ACTIONS.billingSubscriptionUpdated,
      resourceType: "subscription",
      resourceId: subscription.id,
      metadata: { status: subscription.status },
      ip,
    });
    return "processed";
  }
}
