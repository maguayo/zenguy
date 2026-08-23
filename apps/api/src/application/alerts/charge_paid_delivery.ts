import type { AlertRepo } from "../../domain/alerts/repo";
import {
  alertUnitCents,
  quoteFor,
  type Destination,
} from "../../domain/alerts/pricing";
import {
  LOW_BALANCE_THRESHOLD_CENTS,
  isPaidChannelType,
  paidAlertKind,
  type AlertSettings,
  type PaidAlertsPauseReason,
} from "../../domain/alerts/types";
import type { ChannelType } from "../../domain/channels/types";
import type { EmailSender } from "../../domain/email/sender";
import type { UserRepo } from "../../domain/users/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import { renderBasicEmail } from "../../infrastructure/email/templates";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import { ensureAlertSettings, formatEuroCents } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type ChargeSkipReason = PaidAlertsPauseReason | "DAILY_LIMIT";

export type ChargeOutcome =
  | {
      ok: true;
      costCents: number;
      destination: Destination;
      /** True when an earlier attempt already paid for this delivery. */
      replayed: boolean;
    }
  | { ok: false; reason: ChargeSkipReason; message: string };

export interface ChargePaidDeliveryInput {
  workspaceId: string;
  deliveryId: string;
  channelType: ChannelType;
  config: unknown;
}

export interface PaidDeliveryCharger {
  charge(input: ChargePaidDeliveryInput): Promise<ChargeOutcome>;
  refund(input: {
    workspaceId: string;
    deliveryId: string;
    reason: string;
  }): Promise<boolean>;
}

export function phoneNumberOf(config: unknown): string {
  if (
    typeof config === "object" &&
    config !== null &&
    "phoneNumber" in config &&
    typeof config.phoneNumber === "string"
  ) {
    return config.phoneNumber;
  }
  return "";
}

function alertLabel(type: ChannelType): string {
  switch (type) {
    case "CALL":
      return "Phone call";
    case "WHATSAPP":
      return "WhatsApp";
    default:
      return "SMS";
  }
}

/**
 * Debits one paid alert from the workspace's prepaid credit before the
 * provider is called. The debit is idempotent per delivery, so Queue retries
 * never pay twice, and a final provider failure refunds it.
 */
export class ChargePaidDelivery implements PaidDeliveryCharger {
  constructor(
    private readonly alerts: AlertRepo,
    private readonly workspaces: Pick<WorkspaceRepo, "findById">,
    private readonly users: Pick<UserRepo, "findById">,
    private readonly email: EmailSender,
    private readonly appUrl: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async charge(input: ChargePaidDeliveryInput): Promise<ChargeOutcome> {
    if (!isPaidChannelType(input.channelType)) {
      throw new Error("Only SMS, call, and WhatsApp channels are charged");
    }
    const quote = quoteFor(phoneNumberOf(input.config));
    const costCents = alertUnitCents(paidAlertKind(input.channelType), quote);
    const idempotencyKey = `charge:${input.deliveryId}`;
    const existing = await this.alerts.findEntryByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      return {
        ok: true,
        costCents: -existing.amountCents,
        destination: quote.destination,
        replayed: true,
      };
    }

    const now = this.clock.now();
    const settings = await ensureAlertSettings(
      this.alerts,
      input.workspaceId,
      now,
    );
    if (!settings.paidChannelsEnabled) {
      return {
        ok: false,
        reason: "PAID_OFF",
        message: "Skipped: SMS & calls are turned off for this workspace",
      };
    }
    const debit = await this.alerts.debitWithinDailyLimit(
      {
        id: this.ids.newId("ace"),
        workspaceId: input.workspaceId,
        amountCents: costCents,
        idempotencyKey,
        description: `${alertLabel(input.channelType)} to ${quote.destination.name}`,
        deliveryId: input.deliveryId,
        at: now,
      },
      settings.dailyPaidAlertLimit,
      now - DAY_MS,
    );
    if (debit.status === "daily_limit") {
      return {
        ok: false,
        reason: "DAILY_LIMIT",
        message: `Skipped: daily limit of ${settings.dailyPaidAlertLimit} paid alerts reached`,
      };
    }
    if (debit.status === "insufficient_credit") {
      const balanceCents = await this.alerts.getBalanceCents(input.workspaceId);
      await this.notifyCredit(input.workspaceId, settings, balanceCents, "exhausted");
      return {
        ok: false,
        reason: "NO_CREDIT",
        message: `Skipped: not enough alert credit (${formatEuroCents(costCents)} needed, ${formatEuroCents(balanceCents)} left)`,
      };
    }
    const written = debit.write;
    if (written.entry.balanceAfterCents < LOW_BALANCE_THRESHOLD_CENTS) {
      await this.notifyCredit(
        input.workspaceId,
        settings,
        written.entry.balanceAfterCents,
        "low",
      );
    }
    return {
      ok: true,
      costCents,
      destination: quote.destination,
      replayed: false,
    };
  }

  async refund(input: {
    workspaceId: string;
    deliveryId: string;
    reason: string;
  }): Promise<boolean> {
    const charge = await this.alerts.findEntryByIdempotencyKey(
      `charge:${input.deliveryId}`,
    );
    if (charge === null || charge.workspaceId !== input.workspaceId) {
      return false;
    }
    const result = await this.alerts.credit({
      id: this.ids.newId("ace"),
      workspaceId: input.workspaceId,
      amountCents: -charge.amountCents,
      kind: "REFUND",
      idempotencyKey: `refund:${input.deliveryId}`,
      description: `Refund: ${input.reason}`,
      deliveryId: input.deliveryId,
      providerTransactionId: null,
      at: this.clock.now(),
    });
    return result.created;
  }

  private async notifyCredit(
    workspaceId: string,
    settings: AlertSettings,
    balanceCents: number,
    variant: "low" | "exhausted",
  ): Promise<void> {
    if (settings.lowBalanceNotifiedAt !== null) return;
    const now = this.clock.now();
    // Mark before sending so concurrent deliveries cannot each send a notice.
    await this.alerts.updateSettings(
      workspaceId,
      { lowBalanceNotifiedAt: now },
      now,
    );
    try {
      const workspace = await this.workspaces.findById(workspaceId);
      if (workspace === null) return;
      const owner = await this.users.findById(workspace.ownerUserId);
      if (owner === null) return;
      const title =
        variant === "low"
          ? "Alert credit is running low"
          : "Alert credit is used up";
      const bodyLines =
        variant === "low"
          ? [
              `"${workspace.name}" has ${formatEuroCents(balanceCents)} of alert credit left.`,
              "SMS and phone-call alerts pause when it reaches zero. Email, Slack and Discord alerts are not affected.",
            ]
          : [
              `An SMS or phone-call alert for "${workspace.name}" was skipped because the alert credit is used up (${formatEuroCents(balanceCents)} left).`,
              "Email, Slack and Discord alerts keep working. Top up to resume SMS and calls.",
            ];
      const rendered = renderBasicEmail({
        title,
        bodyLines,
        ctaLabel: "Top up alert credit",
        ctaUrl: `${this.appUrl.replace(/\/+$/u, "")}/w/${workspaceId}/alerts/sms-calls`,
      });
      await this.email.send({
        to: [owner.email],
        subject: `Zenguy: ${title}`,
        ...rendered,
      });
    } catch {
      logEvent("alert_credit_notice_failed", { workspaceId });
    }
  }
}
