import { z } from "zod";
import type { AlertRepo } from "../../domain/alerts/repo";
import { ALERT_CREDIT_PACK_CENTS } from "../../domain/alerts/types";
import { ALERT_CREDIT_PURPOSE } from "../alerts/start_credit_topup";
import { ensureAlertSettings } from "../alerts/settings";
import type { WriteAudit } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type {
  PendingOveragePeriodRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type {
  Subscription,
  SubscriptionStatus,
} from "../../domain/billing/types";
import type { Clock } from "../../shared/clock";
import { hmacVerifyHex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import { OVERAGE_SETTLEMENT_DELAY_MS } from "./report_overage_for_period";

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

const subscriptionSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  status: z.string().min(1),
  custom_data: z
    .object({ workspace_id: z.string().min(1) })
    .nullable()
    .optional(),
  current_billing_period: periodSchema.nullable().optional(),
  scheduled_change: z
    .object({ action: z.string().min(1) })
    .nullable()
    .optional(),
});

const transactionSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  custom_data: z
    .object({
      workspace_id: z.string().min(1),
      purpose: z.string().optional(),
    })
    .nullable()
    .optional(),
  items: z
    .array(
      z.object({
        price: z.object({ id: z.string().min(1) }),
        quantity: z.number().int().positive(),
      }),
    )
    .default([]),
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
  }): Promise<unknown>;
}

export interface HandlePaddleWebhookDependencies {
  webhookSecret: string;
  kv: KVNamespace;
  subscriptions: SubscriptionRepo;
  pendingOveragePeriods: PendingOveragePeriodRepo;
  overageReporter: PeriodOverageReporter;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  /** Alert-credit ledger; top-ups are ignored when absent. */
  alerts?: AlertRepo;
  /** Paddle price of one alert-credit pack; top-ups are ignored when null. */
  alertCreditPriceId?: string | null;
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
    const priceId = this.dependencies.alertCreditPriceId ?? null;
    if (alerts === undefined || priceId === null) return "ignored";
    const parsed = transactionSchema.safeParse(rawData);
    if (!parsed.success) return "ignored";
    const data = parsed.data;
    if (
      data.status !== "completed" ||
      data.custom_data === null ||
      data.custom_data === undefined ||
      data.custom_data.purpose !== ALERT_CREDIT_PURPOSE
    ) {
      return "ignored";
    }
    const packs = data.items
      .filter((item) => item.price.id === priceId)
      .reduce((total, item) => total + item.quantity, 0);
    if (packs === 0) {
      logEvent("alert_credit_topup_unmatched", { transactionId: data.id });
      return "ignored";
    }
    const workspaceId = data.custom_data.workspace_id;
    const now = this.dependencies.clock.now();
    const amountCents = packs * ALERT_CREDIT_PACK_CENTS;
    const written = await alerts.credit({
      id: this.dependencies.ids.newId("ace"),
      workspaceId,
      amountCents,
      kind: "TOPUP",
      idempotencyKey: `paddle_txn:${data.id}`,
      description: `Top-up (${packs} × €${ALERT_CREDIT_PACK_CENTS / 100})`,
      deliveryId: null,
      providerTransactionId: data.id,
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

  private async processSubscription(
    eventType: string,
    occurredAtText: string,
    rawData: unknown,
    ip: string | undefined,
  ): Promise<"processed" | "ignored"> {
    const data = subscriptionSchema.parse(rawData);
    const byProvider =
      await this.dependencies.subscriptions.findByProviderSubscriptionId(
        data.id,
      );
    let workspaceId: string;
    if (eventType === "subscription.created") {
      if (data.custom_data?.workspace_id === undefined) {
        throw new Error("Paddle subscription workspace missing");
      }
      workspaceId = data.custom_data.workspace_id;
    } else {
      if (byProvider === null) {
        throw new Error("Paddle subscription workspace missing");
      }
      workspaceId = byProvider.workspaceId;
    }
    const stored =
      byProvider ??
      (await this.dependencies.subscriptions.findByWorkspace(workspaceId));
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

    const subscription: Subscription = {
      id: stored?.id ?? this.dependencies.ids.newId("sub"),
      workspaceId,
      provider: "paddle",
      source: "paddle",
      providerCustomerId: data.customer_id,
      providerSubscriptionId: data.id,
      status: mapStatus(eventType, data.status),
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
