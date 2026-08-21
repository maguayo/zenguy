import type { AlertRepo } from "../../domain/alerts/repo";
import {
  pricingTable,
  quoteFor,
  type PricingTable,
} from "../../domain/alerts/pricing";
import {
  ALERT_CREDIT_MAX_PACKS,
  ALERT_CREDIT_MIN_PACKS,
  ALERT_CREDIT_PACK_CENTS,
  LOW_BALANCE_THRESHOLD_CENTS,
  isPaidChannelType,
  type PaidAlertsPauseReason,
} from "../../domain/alerts/types";
import type { ChannelRepo } from "../../domain/channels/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { decryptSecret } from "../../shared/crypto";
import { phoneNumberOf } from "./charge_paid_delivery";
import { ensureAlertSettings } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface AlertsOverview {
  settings: { paidChannelsEnabled: boolean; dailyPaidAlertLimit: number };
  status: {
    paidChannelCount: number;
    paidAlertsPaused: boolean;
    pauseReason: PaidAlertsPauseReason | null;
  };
  credit: {
    balanceCents: number;
    currency: "EUR";
    lowBalance: boolean;
    lowBalanceThresholdCents: number;
    paidAlertsLast24h: number;
  } | null;
  topUp: {
    available: boolean;
    packCents: number;
    minPacks: number;
    maxPacks: number;
  };
  pricing: PricingTable;
  destinations: { iso: string | null; name: string; channels: number }[];
}

export class GetAlertsOverview {
  constructor(
    private readonly alerts: AlertRepo,
    private readonly channels: Pick<ChannelRepo, "list">,
    private readonly encryptionKey: Uint8Array,
    private readonly topUpAvailable: boolean,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    role: Role;
  }): Promise<AlertsOverview> {
    const now = this.clock.now();
    const [settings, balanceCents, channels] = await Promise.all([
      ensureAlertSettings(this.alerts, input.workspaceId, now),
      this.alerts.getBalanceCents(input.workspaceId),
      this.channels.list(input.workspaceId),
    ]);
    const paidChannels = channels.filter(
      (channel) => channel.enabled && isPaidChannelType(channel.type),
    );
    const destinations = new Map<
      string,
      { iso: string | null; name: string; channels: number }
    >();
    for (const channel of paidChannels) {
      let phoneNumber = "";
      try {
        const plaintext = await decryptSecret(
          channel.encryptedConfig,
          this.encryptionKey,
        );
        phoneNumber = phoneNumberOf(JSON.parse(plaintext) as unknown);
      } catch {
        continue;
      }
      const destination = quoteFor(phoneNumber).destination;
      const current = destinations.get(destination.name) ?? {
        iso: destination.iso,
        name: destination.name,
        channels: 0,
      };
      current.channels += 1;
      destinations.set(destination.name, current);
    }

    const pauseReason: PaidAlertsPauseReason | null =
      !settings.paidChannelsEnabled
        ? "PAID_OFF"
        : balanceCents <= 0
          ? "NO_CREDIT"
          : null;
    const credit = can(input.role, "billing.view")
      ? {
          balanceCents,
          currency: "EUR" as const,
          lowBalance: balanceCents < LOW_BALANCE_THRESHOLD_CENTS,
          lowBalanceThresholdCents: LOW_BALANCE_THRESHOLD_CENTS,
          paidAlertsLast24h: await this.alerts.countCharges(
            input.workspaceId,
            now - DAY_MS,
          ),
        }
      : null;

    return {
      settings: {
        paidChannelsEnabled: settings.paidChannelsEnabled,
        dailyPaidAlertLimit: settings.dailyPaidAlertLimit,
      },
      status: {
        paidChannelCount: paidChannels.length,
        paidAlertsPaused: pauseReason !== null,
        pauseReason,
      },
      credit,
      topUp: {
        available: this.topUpAvailable,
        packCents: ALERT_CREDIT_PACK_CENTS,
        minPacks: ALERT_CREDIT_MIN_PACKS,
        maxPacks: ALERT_CREDIT_MAX_PACKS,
      },
      pricing: pricingTable(),
      destinations: [...destinations.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };
  }
}
