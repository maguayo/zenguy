import type { BillingCanceller } from "../../domain/billing/canceller";
import type {
  BilledTransaction,
  PaddleClient,
} from "../../infrastructure/paddle/client";

export class RecordingBillingCanceller implements BillingCanceller {
  readonly workspaceIds: string[] = [];

  constructor(private readonly failure: Error | null = null) {}

  async cancelForWorkspace(workspaceId: string): Promise<void> {
    this.workspaceIds.push(workspaceId);
    if (this.failure !== null) throw this.failure;
  }
}

export class RecordingPaddleClient implements PaddleClient {
  readonly charges: {
    subscriptionId: string;
    priceId: string;
    quantity: number;
  }[] = [];
  readonly cancellations: string[] = [];
  readonly transactionLists: { subscriptionId: string; limit: number }[] = [];
  readonly invoiceRequests: string[] = [];
  chargeResult: { transactionId: string | null } = { transactionId: null };
  transactions: BilledTransaction[] = [];
  invoiceUrl = "https://example.com/invoice.pdf";

  constructor(private readonly failure: Error | null = null) {}

  private failIfConfigured(): void {
    if (this.failure !== null) throw this.failure;
  }

  async createOneTimeCharge(
    subscriptionId: string,
    priceId: string,
    quantity: number,
  ): Promise<{ transactionId: string | null }> {
    this.charges.push({ subscriptionId, priceId, quantity });
    this.failIfConfigured();
    return { ...this.chargeResult };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    this.cancellations.push(subscriptionId);
    this.failIfConfigured();
  }

  async listBilledTransactions(
    subscriptionId: string,
    limit = 12,
  ): Promise<BilledTransaction[]> {
    this.transactionLists.push({ subscriptionId, limit });
    this.failIfConfigured();
    return this.transactions.map((transaction) => ({ ...transaction }));
  }

  async getInvoicePdfUrl(transactionId: string): Promise<string> {
    this.invoiceRequests.push(transactionId);
    this.failIfConfigured();
    return this.invoiceUrl;
  }
}
