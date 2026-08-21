import type {
  BilledTransaction,
  PaddleClient,
  SubscriptionManagementUrls,
} from "./client";

function paddleUnavailable(): never {
  throw new Error("Paddle is not configured");
}

export class UnavailablePaddleClient implements PaddleClient {
  async createOneTimeCharge(): Promise<{ transactionId: string | null }> {
    return paddleUnavailable();
  }

  async findSubscriptionChargeByMarker(): Promise<{
    transactionId: string;
  } | null> {
    return paddleUnavailable();
  }

  async cancelSubscription(): Promise<void> {
    return paddleUnavailable();
  }

  async listBilledTransactions(): Promise<BilledTransaction[]> {
    return paddleUnavailable();
  }

  async getSubscriptionManagementUrls(): Promise<SubscriptionManagementUrls> {
    return paddleUnavailable();
  }

  async getInvoicePdfUrl(): Promise<string> {
    return paddleUnavailable();
  }
}
