import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  BillingCurrency,
  SubscriptionSource,
  SubscriptionStatus,
} from "../../domain/billing/types";
import { isComplimentarySubscription } from "../../domain/billing/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type {
  BilledTransaction,
  BillingProviderClient,
  SubscriptionManagementUrls,
} from "../../infrastructure/billing/provider";
import {
  INCLUDED_RUNS,
  OVERAGE_CENTS_PER_RUN,
  PLAN_PRICE_CENTS,
} from "../../shared/constants";
import { forbidden } from "../../shared/errors";
import { logEvent } from "../../shared/log";
import type { CycleUsage, GetCycleUsage } from "./get_cycle_usage";

export interface BillingDetails {
  plan: {
    pricePerMonthCents: number;
    currency: BillingCurrency;
    includedRuns: number;
    overagePerRunCents: number;
  };
  subscription: {
    status: SubscriptionStatus;
    source: SubscriptionSource;
    periodStart: number | null;
    periodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    updatePaymentMethodUrl: string | null;
    cancelUrl: string | null;
  };
  usage: CycleUsage;
  invoices: BilledTransaction[];
}

export class GetBilling {
  constructor(
    private readonly subscriptions: SubscriptionRepo,
    private readonly getCycleUsage: Pick<GetCycleUsage, "execute">,
    private readonly billingProvider: BillingProviderClient,
  ) {}

  async execute(input: {
    workspaceId: string;
    role: Role;
    regionalCurrency?: BillingCurrency;
  }): Promise<BillingDetails> {
    if (!can(input.role, "billing.view")) throw forbidden();
    const subscription = await this.subscriptions.findByWorkspace(
      input.workspaceId,
    );
    const complimentary = isComplimentarySubscription(subscription);
    const usage = await this.getCycleUsage.execute({
      workspaceId: input.workspaceId,
      fallbackCurrency: input.regionalCurrency,
    });
    const providerSubscriptionId = subscription?.providerSubscriptionId;
    let invoices: BilledTransaction[] = [];
    if (
      providerSubscriptionId !== null &&
      providerSubscriptionId !== undefined
    ) {
      try {
        invoices = await this.billingProvider.listBilledTransactions(
          providerSubscriptionId,
        );
      } catch {
        logEvent("billing_invoice_list_failed", {
          workspaceId: input.workspaceId,
        });
      }
    }
    const canManage = can(input.role, "billing.manage");
    let managementUrls: SubscriptionManagementUrls | null = null;
    if (
      canManage &&
      providerSubscriptionId !== null &&
      providerSubscriptionId !== undefined
    ) {
      try {
        managementUrls =
          await this.billingProvider.getSubscriptionManagementUrls(
            providerSubscriptionId,
          );
      } catch {
        logEvent("billing_management_urls_failed", {
          workspaceId: input.workspaceId,
        });
      }
    }
    return {
      plan: {
        pricePerMonthCents: complimentary ? 0 : PLAN_PRICE_CENTS,
        currency: usage.currency,
        includedRuns: INCLUDED_RUNS,
        overagePerRunCents: complimentary ? 0 : OVERAGE_CENTS_PER_RUN,
      },
      subscription: {
        status: subscription?.status ?? "NONE",
        source:
          subscription?.source ??
          (subscription?.provider === "internal"
            ? "free"
            : subscription?.provider ?? "stripe"),
        periodStart: subscription?.periodStart ?? null,
        periodEnd: subscription?.periodEnd ?? null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        updatePaymentMethodUrl:
          managementUrls?.updatePaymentMethodUrl ?? null,
        cancelUrl: managementUrls?.cancelUrl ?? null,
      },
      usage,
      invoices,
    };
  }
}
