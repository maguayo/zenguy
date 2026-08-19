import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { SubscriptionStatus } from "../../domain/billing/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type {
  BilledTransaction,
  PaddleClient,
} from "../../infrastructure/paddle/client";
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
    currency: "EUR";
    includedRuns: number;
    overagePerRunCents: number;
  };
  subscription: {
    status: SubscriptionStatus;
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
    private readonly paddle: PaddleClient,
  ) {}

  async execute(input: {
    workspaceId: string;
    role: Role;
  }): Promise<BillingDetails> {
    if (!can(input.role, "billing.view")) throw forbidden();
    const subscription = await this.subscriptions.findByWorkspace(
      input.workspaceId,
    );
    const usage = await this.getCycleUsage.execute({
      workspaceId: input.workspaceId,
    });
    let invoices: BilledTransaction[] = [];
    if (subscription?.providerSubscriptionId !== null &&
        subscription?.providerSubscriptionId !== undefined) {
      try {
        invoices = await this.paddle.listBilledTransactions(
          subscription.providerSubscriptionId,
        );
      } catch {
        logEvent("billing_invoice_list_failed", {
          workspaceId: input.workspaceId,
        });
      }
    }
    const canManage = can(input.role, "billing.manage");
    return {
      plan: {
        pricePerMonthCents: PLAN_PRICE_CENTS,
        currency: "EUR",
        includedRuns: INCLUDED_RUNS,
        overagePerRunCents: OVERAGE_CENTS_PER_RUN,
      },
      subscription: {
        status: subscription?.status ?? "NONE",
        periodStart: subscription?.periodStart ?? null,
        periodEnd: subscription?.periodEnd ?? null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        updatePaymentMethodUrl: canManage
          ? (subscription?.updatePaymentUrl ?? null)
          : null,
        cancelUrl: canManage ? (subscription?.cancelUrl ?? null) : null,
      },
      usage,
      invoices,
    };
  }
}
