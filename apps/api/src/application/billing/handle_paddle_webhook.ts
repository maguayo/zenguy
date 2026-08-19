import { z } from "zod";
import type { WriteAudit } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  Subscription,
  SubscriptionStatus,
} from "../../domain/billing/types";
import type { Clock } from "../../shared/clock";
import { hmacVerifyHex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";

const SIGNATURE_TOLERANCE_MS = 15 * 60 * 1_000;
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

const envelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
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
  }): Promise<unknown>;
}

export interface HandlePaddleWebhookDependencies {
  webhookSecret: string;
  kv: KVNamespace;
  subscriptions: SubscriptionRepo;
  overageReporter: PeriodOverageReporter;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
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
      await this.processSubscription(event.event_type, event.data, input.ip);
      handled = "processed";
    }

    await this.dependencies.kv.put(idempotencyKey, "1", {
      expirationTtl: IDEMPOTENCY_TTL_SECONDS,
    });
    return { handled };
  }

  private async processSubscription(
    eventType: string,
    rawData: unknown,
    ip: string | undefined,
  ): Promise<void> {
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

    if (
      stored?.periodStart !== null &&
      stored?.periodStart !== undefined &&
      stored.periodStart !== periodStart &&
      stored.periodEnd !== null
    ) {
      try {
        await this.dependencies.overageReporter.execute({
          workspaceId,
          periodStart: stored.periodStart,
          periodEnd: stored.periodEnd,
        });
      } catch {
        logEvent("overage_rollover_failed", { workspaceId });
      }
    }

    const now = this.dependencies.clock.now();
    const subscription: Subscription = {
      id: stored?.id ?? this.dependencies.ids.newId("sub"),
      workspaceId,
      provider: "paddle",
      providerCustomerId: data.customer_id,
      providerSubscriptionId: data.id,
      status: mapStatus(eventType, data.status),
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: data.scheduled_change?.action === "cancel",
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: stored?.createdAt ?? now,
      updatedAt: now,
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
  }
}
