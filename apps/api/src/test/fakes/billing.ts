import type { BillingCanceller } from "../../domain/billing/canceller";
import type {
  BilledTransaction,
  ApprovedPaddleAdjustment,
  PaddleClient,
  SubscriptionManagementUrls,
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
    marker: string;
  }[] = [];
  readonly cancellations: string[] = [];
  readonly transactionLists: { subscriptionId: string; limit: number }[] = [];
  readonly subscriptionChargeLookups: {
    subscriptionId: string;
    marker: string;
  }[] = [];
  readonly managementUrlRequests: string[] = [];
  readonly invoiceRequests: string[] = [];
  readonly adjustmentRequests: string[] = [];
  adjustments: ApprovedPaddleAdjustment[] = [];
  chargeResult: { transactionId: string | null } = { transactionId: null };
  chargeFailure: Error | null = null;
  acceptChargeBeforeFailure = false;
  readonly subscriptionCharges = new Map<string, string>();
  transactions: BilledTransaction[] = [];
  managementUrls: SubscriptionManagementUrls = {
    updatePaymentMethodUrl: "https://example.com/update-payment-method",
    cancelUrl: "https://example.com/cancel-subscription",
  };
  managementUrlsFailure: Error | null = null;
  invoiceUrl = "https://example.com/invoice.pdf";

  constructor(private readonly failure: Error | null = null) {}

  private failIfConfigured(): void {
    if (this.failure !== null) throw this.failure;
  }

  private subscriptionChargeKey(subscriptionId: string, marker: string): string {
    return JSON.stringify([subscriptionId, marker]);
  }

  async createOneTimeCharge(
    subscriptionId: string,
    priceId: string,
    quantity: number,
    marker: string,
  ): Promise<{ transactionId: string | null }> {
    this.charges.push({ subscriptionId, priceId, quantity, marker });
    this.failIfConfigured();
    if (this.acceptChargeBeforeFailure) {
      this.subscriptionCharges.set(
        this.subscriptionChargeKey(subscriptionId, marker),
        `txn_accepted_${String(this.charges.length).padStart(4, "0")}`,
      );
    }
    if (this.chargeFailure !== null) throw this.chargeFailure;
    if (this.chargeResult.transactionId !== null) {
      this.subscriptionCharges.set(
        this.subscriptionChargeKey(subscriptionId, marker),
        this.chargeResult.transactionId,
      );
    }
    return { ...this.chargeResult };
  }

  async findSubscriptionChargeByMarker(
    subscriptionId: string,
    marker: string,
  ): Promise<{ transactionId: string } | null> {
    this.subscriptionChargeLookups.push({ subscriptionId, marker });
    this.failIfConfigured();
    const transactionId = this.subscriptionCharges.get(
      this.subscriptionChargeKey(subscriptionId, marker),
    );
    return transactionId === undefined ? null : { transactionId };
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

  async getSubscriptionManagementUrls(
    subscriptionId: string,
  ): Promise<SubscriptionManagementUrls> {
    this.managementUrlRequests.push(subscriptionId);
    if (this.managementUrlsFailure !== null) {
      throw this.managementUrlsFailure;
    }
    this.failIfConfigured();
    return { ...this.managementUrls };
  }

  async getInvoicePdfUrl(transactionId: string): Promise<string> {
    this.invoiceRequests.push(transactionId);
    this.failIfConfigured();
    return this.invoiceUrl;
  }

  async listApprovedAdjustments(
    transactionId: string,
  ): Promise<ApprovedPaddleAdjustment[]> {
    this.adjustmentRequests.push(transactionId);
    this.failIfConfigured();
    return this.adjustments
      .filter((adjustment) => adjustment.transactionId === transactionId)
      .map((adjustment) => ({ ...adjustment }));
  }
}
