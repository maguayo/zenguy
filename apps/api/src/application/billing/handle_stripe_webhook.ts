import { z } from "zod";
import type { AlertRepo } from "../../domain/alerts/repo";
import { ALERT_CREDIT_PACK_CENTS } from "../../domain/alerts/types";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type {
  CheckoutIntentRepo,
  PendingOveragePeriodRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type {
  CheckoutIntent,
  Subscription,
  SubscriptionStatus,
} from "../../domain/billing/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import { hmacVerifyHex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import type { WriteAudit } from "../audit/write_audit";
import { ALERT_CREDIT_PURPOSE } from "../alerts/start_credit_topup";
import { ensureAlertSettings } from "../alerts/settings";
import { OVERAGE_SETTLEMENT_DELAY_MS } from "./report_overage_for_period";
import type { PeriodOverageReporter } from "./handle_paddle_webhook";
import { PLAN_PRICE_CENTS } from "../../shared/constants";

const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1_000;
const IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_SIGNATURE_HEADER_LENGTH = 8_192;

const metadataSchema = z.record(z.string(), z.string()).default({});
const expandableIdSchema = z
  .union([z.string().min(1), z.object({ id: z.string().min(1) })])
  .transform((value) => (typeof value === "string" ? value : value.id));

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number().int().nonnegative(),
  data: z.object({ object: z.unknown() }),
});

const subscriptionItemSchema = z.object({
  quantity: z.number().int().positive().nullable().optional(),
  current_period_start: z.number().int().nonnegative().optional(),
  current_period_end: z.number().int().positive().optional(),
  price: z.object({
    id: z.string().min(1),
    product: expandableIdSchema,
    currency: z.string().length(3),
    unit_amount: z.number().int().positive().nullable(),
    recurring: z.object({ interval: z.string().min(1) }).nullable().optional(),
  }),
});

const subscriptionSchema = z.object({
  id: z.string().min(1),
  customer: expandableIdSchema,
  status: z.string().min(1),
  metadata: metadataSchema,
  items: z.object({ data: z.array(subscriptionItemSchema).min(1) }),
  current_period_start: z.number().int().nonnegative().optional(),
  current_period_end: z.number().int().positive().optional(),
  cancel_at_period_end: z.boolean().default(false),
  cancel_at: z.number().int().positive().nullable().optional(),
});

const checkoutSessionSchema = z.object({
  id: z.string().min(1),
  mode: z.string().min(1),
  payment_status: z.string().min(1),
  client_reference_id: z.string().nullable().optional(),
  customer: expandableIdSchema.nullable(),
  payment_intent: expandableIdSchema.nullable(),
  currency: z.string().length(3).nullable(),
  amount_subtotal: z.number().int().nonnegative().nullable(),
  metadata: metadataSchema,
});

const refundSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1).nullable(),
  payment_intent: expandableIdSchema.nullable(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
});

const disputeSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  payment_intent: expandableIdSchema.nullable(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
});

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export interface HandleStripeWebhookDependencies {
  webhookSecret: string;
  kv: KVNamespace;
  subscriptions: SubscriptionRepo;
  checkoutIntents: CheckoutIntentRepo;
  workspaces: Pick<WorkspaceRepo, "findById">;
  pendingOveragePeriods: PendingOveragePeriodRepo;
  overageReporter: PeriodOverageReporter;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  alerts?: AlertRepo;
  alertCreditProductId?: string | null;
  alertCreditPriceId?: string | null;
  subscriptionProductId: string;
  subscriptionPriceId: string;
}

function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "Invalid Stripe signature");
}

function parseSignature(header: string | null): {
  timestamp: number;
  signatures: string[];
} {
  if (
    header === null ||
    header.length === 0 ||
    header.length > MAX_SIGNATURE_HEADER_LENGTH
  ) {
    throw unauthorized();
  }
  let timestampText: string | undefined;
  const signatures: string[] = [];
  for (const component of header.split(",")) {
    const separator = component.indexOf("=");
    if (separator <= 0) continue;
    const key = component.slice(0, separator).trim();
    const value = component.slice(separator + 1).trim();
    if (key === "t" && timestampText === undefined) timestampText = value;
    if (key === "v1" && /^[0-9a-f]{64}$/iu.test(value)) signatures.push(value);
  }
  if (
    timestampText === undefined ||
    !/^\d+$/u.test(timestampText) ||
    signatures.length === 0
  ) {
    throw unauthorized();
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw unauthorized();
  return { timestamp, signatures };
}

function mapStatus(eventType: string, status: string): SubscriptionStatus {
  if (eventType === "customer.subscription.deleted") return "CANCELED";
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "CANCELED";
    default:
      throw new Error("Unsupported Stripe subscription status");
  }
}

function secondsToMilliseconds(value: number): number {
  const timestamp = value * 1_000;
  if (!Number.isSafeInteger(timestamp)) {
    throw new Error("Invalid Stripe timestamp");
  }
  return timestamp;
}

export class HandleStripeWebhook {
  constructor(private readonly dependencies: HandleStripeWebhookDependencies) {}

  private async verifySignature(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<void> {
    const { timestamp, signatures } = parseSignature(signatureHeader);
    const timestampMs = secondsToMilliseconds(timestamp);
    const age = this.dependencies.clock.now() - timestampMs;
    if (age > SIGNATURE_TOLERANCE_MS || age < -SIGNATURE_TOLERANCE_MS) {
      throw unauthorized();
    }
    const payload = `${timestamp}.${rawBody}`;
    for (const signature of signatures) {
      if (
        await hmacVerifyHex(
          this.dependencies.webhookSecret,
          payload,
          signature,
        )
      ) {
        return;
      }
    }
    throw unauthorized();
  }

  private async consumeIntent(input: {
    intentId: string | undefined;
    purpose: CheckoutIntent["purpose"];
    providerReference: string;
    currentCatalog: { productId: string; priceId: string };
    amountCents?: number;
    currency?: string;
  }): Promise<CheckoutIntent> {
    if (input.intentId === undefined || input.intentId.length === 0) {
      throw new Error("Stripe checkout intent is missing");
    }
    const intent = await this.dependencies.checkoutIntents.findById(
      input.intentId,
    );
    if (
      intent === null ||
      intent.purpose !== input.purpose ||
      intent.productId !== input.currentCatalog.productId ||
      intent.priceId !== input.currentCatalog.priceId ||
      (input.amountCents !== undefined &&
        input.amountCents !== intent.amountCents) ||
      (input.currency !== undefined &&
        input.currency.toUpperCase() !== intent.currencyCode)
    ) {
      throw new Error("Stripe checkout does not match the server intent");
    }
    const workspace = await this.dependencies.workspaces.findById(
      intent.workspaceId,
    );
    if (
      workspace === null ||
      workspace.deletedAt !== null ||
      workspace.ownerUserId !== intent.actorUserId
    ) {
      throw new Error("Stripe checkout owner is no longer authorized");
    }
    const consumed = await this.dependencies.checkoutIntents.consume(
      intent.id,
      input.providerReference,
      this.dependencies.clock.now(),
    );
    if (consumed === "unavailable") {
      throw new Error("Stripe checkout intent is expired or already consumed");
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
      throw new Error("Invalid Stripe webhook payload");
    }
    const event = eventSchema.parse(decoded);
    const idempotencyKey = `stripe_evt:${event.id}`;
    if ((await this.dependencies.kv.get(idempotencyKey)) !== null) {
      return { handled: "duplicate" };
    }

    let handled: "processed" | "ignored" = "ignored";
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      handled = await this.processSubscription(
        event.type,
        event.created,
        event.data.object,
        input.ip,
      );
    } else if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      handled = await this.processCheckout(event.data.object, input.ip);
    } else if (
      event.type === "refund.created" ||
      event.type === "refund.updated"
    ) {
      handled = await this.processRefund(event.data.object, input.ip);
    } else if (
      event.type === "charge.dispute.created" ||
      event.type === "charge.dispute.closed"
    ) {
      handled = await this.processDispute(event.data.object, input.ip);
    }

    await this.dependencies.kv.put(idempotencyKey, "1", {
      expirationTtl: IDEMPOTENCY_TTL_SECONDS,
    });
    return { handled };
  }

  private async processCheckout(
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const alerts = this.dependencies.alerts;
    const productId = this.dependencies.alertCreditProductId ?? null;
    const priceId = this.dependencies.alertCreditPriceId ?? null;
    if (alerts === undefined || productId === null || priceId === null) {
      return "ignored";
    }
    const parsed = checkoutSessionSchema.safeParse(rawData);
    if (!parsed.success) return "ignored";
    const data = parsed.data;
    if (
      data.mode !== "payment" ||
      data.payment_status !== "paid" ||
      data.payment_intent === null ||
      data.customer === null ||
      data.currency === null ||
      data.amount_subtotal === null ||
      data.metadata.purpose !== ALERT_CREDIT_PURPOSE
    ) {
      return "ignored";
    }
    const intentId = data.metadata.checkout_intent_id;
    if (
      data.client_reference_id !== null &&
      data.client_reference_id !== undefined &&
      data.client_reference_id !== intentId
    ) {
      throw new Error("Stripe checkout client reference mismatch");
    }
    const intent = await this.consumeIntent({
      intentId,
      purpose: ALERT_CREDIT_PURPOSE,
      providerReference: data.id,
      currentCatalog: { productId, priceId },
      amountCents: data.amount_subtotal,
      currency: data.currency,
    });
    const now = this.dependencies.clock.now();
    const written = await alerts.credit({
      id: this.dependencies.ids.newId("ace"),
      workspaceId: intent.workspaceId,
      amountCents: intent.amountCents,
      kind: "TOPUP",
      idempotencyKey: `stripe_pi:${data.payment_intent}`,
      description: `Top-up (${intent.quantity} × €${ALERT_CREDIT_PACK_CENTS / 100})`,
      deliveryId: null,
      providerTransactionId: data.payment_intent,
      providerCustomerId: data.customer,
      at: now,
    });
    if (!written.created) return "processed";
    await ensureAlertSettings(alerts, intent.workspaceId, now);
    await alerts.updateSettings(
      intent.workspaceId,
      { lowBalanceNotifiedAt: null },
      now,
    );
    await this.dependencies.audit.execute({
      workspaceId: intent.workspaceId,
      actorUserId: null,
      action: AUDIT_ACTIONS.alertsCreditTopup,
      resourceType: "alert_credit",
      resourceId: data.payment_intent,
      metadata: { amountCents: intent.amountCents, packs: intent.quantity },
      ip,
    });
    return "processed";
  }

  private async processRefund(
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const alerts = this.dependencies.alerts;
    if (alerts === undefined) return "ignored";
    const parsed = refundSchema.safeParse(rawData);
    if (!parsed.success) return "ignored";
    const data = parsed.data;
    if (data.status !== "succeeded" || data.payment_intent === null) {
      return "ignored";
    }
    const topup = await alerts.findTopupByProviderTransactionId(
      data.payment_intent,
    );
    if (topup === null) return "ignored";
    if (data.currency.toUpperCase() !== "EUR") {
      throw new Error("Stripe refund currency mismatch");
    }
    const written = await alerts.adjust({
      id: this.dependencies.ids.newId("ace"),
      workspaceId: topup.workspaceId,
      amountCents: -data.amount,
      idempotencyKey: `stripe_refund:${data.id}:succeeded`,
      description: `Stripe refund (${data.id})`,
      providerTransactionId: data.payment_intent,
      at: this.dependencies.clock.now(),
    });
    if (written === null) {
      throw new Error("Stripe refund exceeds credited transaction");
    }
    if (written.created) {
      await this.auditAdjustment(
        topup.workspaceId,
        data.id,
        "refund",
        -data.amount,
        data.payment_intent,
        ip,
      );
    }
    return "processed";
  }

  private async processDispute(
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const alerts = this.dependencies.alerts;
    if (alerts === undefined) return "ignored";
    const parsed = disputeSchema.safeParse(rawData);
    if (!parsed.success) return "ignored";
    const data = parsed.data;
    if (data.payment_intent === null) return "ignored";
    const topup = await alerts.findTopupByProviderTransactionId(
      data.payment_intent,
    );
    if (topup === null) return "ignored";
    if (data.currency.toUpperCase() !== "EUR") {
      throw new Error("Stripe dispute currency mismatch");
    }
    const debit = await alerts.adjust({
      id: this.dependencies.ids.newId("ace"),
      workspaceId: topup.workspaceId,
      amountCents: -data.amount,
      idempotencyKey: `stripe_dispute:${data.id}:debit`,
      description: `Stripe dispute (${data.id})`,
      providerTransactionId: data.payment_intent,
      at: this.dependencies.clock.now(),
    });
    if (debit === null) {
      throw new Error("Stripe dispute exceeds credited transaction");
    }
    if (debit.created) {
      await this.auditAdjustment(
        topup.workspaceId,
        data.id,
        "dispute",
        -data.amount,
        data.payment_intent,
        ip,
      );
    }
    if (data.status === "won") {
      const reversal = await alerts.adjust({
        id: this.dependencies.ids.newId("ace"),
        workspaceId: topup.workspaceId,
        amountCents: data.amount,
        idempotencyKey: `stripe_dispute:${data.id}:won`,
        description: `Stripe dispute won (${data.id})`,
        providerTransactionId: data.payment_intent,
        at: this.dependencies.clock.now(),
      });
      if (reversal === null) {
        throw new Error("Stripe dispute reversal is not backed by a debit");
      }
      if (reversal.created) {
        await this.auditAdjustment(
          topup.workspaceId,
          data.id,
          "dispute_won",
          data.amount,
          data.payment_intent,
          ip,
        );
      }
    }
    return "processed";
  }

  private async auditAdjustment(
    workspaceId: string,
    resourceId: string,
    action: string,
    amountCents: number,
    transactionId: string,
    ip: string | undefined,
  ): Promise<void> {
    await this.dependencies.audit.execute({
      workspaceId,
      actorUserId: null,
      action: AUDIT_ACTIONS.alertsCreditAdjusted,
      resourceType: "alert_credit",
      resourceId,
      metadata: { action, amountCents, transactionId },
      ip,
    });
  }

  private assertSubscriptionCatalog(
    data: z.infer<typeof subscriptionSchema>,
  ): z.infer<typeof subscriptionItemSchema> {
    const item = data.items.data[0];
    if (
      data.items.data.length !== 1 ||
      item === undefined ||
      item.quantity !== 1 ||
      item.price.id !== this.dependencies.subscriptionPriceId ||
      item.price.product !== this.dependencies.subscriptionProductId ||
      item.price.currency.toUpperCase() !== "EUR" ||
      item.price.unit_amount !== PLAN_PRICE_CENTS ||
      item.price.recurring?.interval !== "month"
    ) {
      throw new Error("Stripe subscription catalog mismatch");
    }
    return item;
  }

  private async processSubscription(
    eventType: string,
    eventCreated: number,
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const data = subscriptionSchema.parse(rawData);
    const item = this.assertSubscriptionCatalog(data);
    const byProvider =
      await this.dependencies.subscriptions.findByProviderSubscriptionId(
        data.id,
      );
    let workspaceId: string;
    if (eventType === "customer.subscription.created") {
      const intent = await this.consumeIntent({
        intentId: data.metadata.checkout_intent_id,
        purpose: "subscription",
        providerReference: data.id,
        currentCatalog: {
          productId: this.dependencies.subscriptionProductId,
          priceId: this.dependencies.subscriptionPriceId,
        },
        amountCents: PLAN_PRICE_CENTS,
        currency: item.price.currency,
      });
      workspaceId = intent.workspaceId;
      if (byProvider !== null && byProvider.workspaceId !== workspaceId) {
        throw new Error("Stripe subscription is already bound to another workspace");
      }
    } else {
      if (byProvider === null) {
        throw new Error("Stripe subscription workspace missing");
      }
      workspaceId = byProvider.workspaceId;
      if (
        byProvider.providerCustomerId !== null &&
        byProvider.providerCustomerId !== data.customer
      ) {
        throw new Error("Stripe customer does not match the subscription owner");
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
      throw new Error("Workspace already has a different Stripe subscription");
    }
    if (
      stored?.providerCustomerId !== null &&
      stored?.providerCustomerId !== undefined &&
      stored.provider === "stripe" &&
      stored.providerCustomerId !== data.customer
    ) {
      throw new Error("Workspace already belongs to a different Stripe customer");
    }
    const providerEventAt = secondsToMilliseconds(eventCreated);
    if (
      stored?.lastProviderEventAt !== null &&
      stored?.lastProviderEventAt !== undefined &&
      providerEventAt < stored.lastProviderEventAt
    ) {
      logEvent("stripe_subscription_event_stale", { workspaceId });
      return "ignored";
    }

    const periodStartSeconds =
      item.current_period_start ?? data.current_period_start;
    const periodEndSeconds = item.current_period_end ?? data.current_period_end;
    const periodStart =
      periodStartSeconds === undefined
        ? null
        : secondsToMilliseconds(periodStartSeconds);
    const periodEnd =
      periodEndSeconds === undefined
        ? null
        : secondsToMilliseconds(periodEndSeconds);
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
    }

    const status = mapStatus(eventType, data.status);
    const subscription: Subscription = {
      id: stored?.id ?? this.dependencies.ids.newId("sub"),
      workspaceId,
      provider: "stripe",
      source: "stripe",
      providerCustomerId: data.customer,
      providerSubscriptionId: data.id,
      status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd:
        data.cancel_at_period_end || data.cancel_at !== null && data.cancel_at !== undefined,
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
