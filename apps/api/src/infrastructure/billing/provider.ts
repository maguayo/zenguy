export interface BilledTransaction {
  id: string;
  billedAt: string | null;
  status: string;
  totalCents: number;
  currency: string;
  invoiceNumber: string | null;
}

export interface SubscriptionManagementUrls {
  updatePaymentMethodUrl: string | null;
  cancelUrl: string;
}

export interface ProviderAdjustment {
  id: string;
  action: string;
  transactionId: string;
  customerId: string;
  amountCents: number;
  currency: string;
}

export interface BillingProviderClient {
  createOneTimeCharge(
    subscriptionId: string,
    priceId: string,
    quantity: number,
    marker: string,
  ): Promise<{ transactionId: string | null }>;
  findSubscriptionChargeByMarker(
    subscriptionId: string,
    marker: string,
  ): Promise<{ transactionId: string } | null>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  listBilledTransactions(
    subscriptionId: string,
    limit?: number,
  ): Promise<BilledTransaction[]>;
  getSubscriptionManagementUrls(
    subscriptionId: string,
  ): Promise<SubscriptionManagementUrls>;
  getInvoicePdfUrl(transactionId: string): Promise<string>;
  listApprovedAdjustments(
    transactionId: string,
  ): Promise<ProviderAdjustment[]>;
}
