import type { SubscriptionRepo } from "../../domain/billing/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { BillingProviderClient } from "../../infrastructure/billing/provider";
import { forbidden, notFound } from "../../shared/errors";

export class GetInvoiceUrl {
  constructor(
    private readonly subscriptions: SubscriptionRepo,
    private readonly billingProvider: BillingProviderClient,
  ) {}

  async execute(input: {
    workspaceId: string;
    role: Role;
    transactionId: string;
  }): Promise<{ url: string }> {
    if (!can(input.role, "billing.view")) throw forbidden();
    const subscription = await this.subscriptions.findByWorkspace(
      input.workspaceId,
    );
    if (subscription?.providerSubscriptionId === null ||
        subscription?.providerSubscriptionId === undefined) {
      throw notFound("Invoice");
    }
    const transactions = await this.billingProvider.listBilledTransactions(
      subscription.providerSubscriptionId,
    );
    if (!transactions.some(({ id }) => id === input.transactionId)) {
      throw notFound("Invoice");
    }
    return {
      url: await this.billingProvider.getInvoicePdfUrl(input.transactionId),
    };
  }
}
