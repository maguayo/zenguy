import type { AppConfig } from "../../shared/config";
import { logEvent } from "../../shared/log";

export interface BilledTransaction {
  id: string;
  billedAt: string | null;
  status: string;
  totalCents: number;
  currency: string;
  invoiceNumber: string | null;
}

export interface PaddleClient {
  createOneTimeCharge(
    subscriptionId: string,
    priceId: string,
    quantity: number,
  ): Promise<{ transactionId: string | null }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  listBilledTransactions(
    subscriptionId: string,
    limit?: number,
  ): Promise<BilledTransaction[]>;
  getInvoicePdfUrl(transactionId: string): Promise<string>;
}

export type PaddleFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type PaddleConfig = Pick<AppConfig["paddle"], "apiKey" | "apiBase">;

function invalidResponse(): never {
  throw new Error("paddle response invalid");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidResponse();
  }
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value : invalidResponse();
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return value === null || typeof value === "string"
    ? value
    : invalidResponse();
}

function minorUnits(value: string): number {
  if (!/^-?\d+$/u.test(value)) return invalidResponse();
  const amount = Number.parseInt(value, 10);
  return Number.isSafeInteger(amount) ? amount : invalidResponse();
}

export class HttpPaddleClient implements PaddleClient {
  constructor(
    private readonly config: PaddleConfig,
    private readonly fetchFn: PaddleFetch = fetch,
  ) {}

  private async request(
    endpoint: string,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const response = await this.fetchFn(`${this.config.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      logEvent("paddle_error", { status: response.status, endpoint });
      // Do not read or log Paddle's response body: it may contain PII.
      throw new Error(`paddle error ${response.status}`);
    }
    return response;
  }

  async createOneTimeCharge(
    subscriptionId: string,
    priceId: string,
    quantity: number,
  ): Promise<{ transactionId: string | null }> {
    await this.request(
      "subscriptions.charge",
      `/subscriptions/${encodeURIComponent(subscriptionId)}/charge`,
      {
        method: "POST",
        body: JSON.stringify({
          effective_from: "immediately",
          items: [{ price_id: priceId, quantity }],
        }),
      },
    );

    // DEVIATION: the current Paddle API returns the updated subscription, not
    // the asynchronously-created transaction. Consumers discover that charge
    // through listBilledTransactions, so the required nullable contract is null.
    return { transactionId: null };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.request(
      "subscriptions.cancel",
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ effective_from: "immediately" }),
      },
    );
  }

  async listBilledTransactions(
    subscriptionId: string,
    limit = 12,
  ): Promise<BilledTransaction[]> {
    const query = new URLSearchParams({
      subscription_id: subscriptionId,
      status: "billed,paid,completed",
      order_by: "billed_at[DESC]",
      per_page: String(limit),
    });
    const response = await this.request(
      "transactions.list",
      `/transactions?${query.toString()}`,
      { method: "GET" },
    );
    const payload: unknown = await response.json();
    const data = asRecord(payload).data;
    if (!Array.isArray(data)) return invalidResponse();

    return data.map((value) => {
      const transaction = asRecord(value);
      const details = asRecord(transaction.details);
      const totals = asRecord(details.totals);
      return {
        id: requiredString(transaction, "id"),
        billedAt: nullableString(transaction, "billed_at"),
        status: requiredString(transaction, "status"),
        totalCents: minorUnits(requiredString(totals, "grand_total")),
        currency: requiredString(transaction, "currency_code"),
        invoiceNumber: nullableString(transaction, "invoice_number"),
      };
    });
  }

  async getInvoicePdfUrl(transactionId: string): Promise<string> {
    const response = await this.request(
      "transactions.invoice",
      `/transactions/${encodeURIComponent(transactionId)}/invoice`,
      { method: "GET" },
    );
    const payload: unknown = await response.json();
    return requiredString(asRecord(asRecord(payload).data), "url");
  }
}
