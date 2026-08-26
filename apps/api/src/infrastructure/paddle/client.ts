import type { AppConfig } from "../../shared/config";
import { OVERAGE_CENTS_PER_RUN } from "../../shared/constants";
import {
  cancelResponseBody,
  externalProviderSignal,
  readLimitedJsonResponse,
} from "../../shared/limited_response";
import { logEvent } from "../../shared/log";
import type {
  BilledTransaction,
  BillingProviderClient,
  ProviderAdjustment,
  SubscriptionManagementUrls,
} from "../billing/provider";

export type {
  BilledTransaction,
  SubscriptionManagementUrls,
} from "../billing/provider";

const MAX_PADDLE_RESPONSE_BYTES = 1_024 * 1_024;
const MAX_PADDLE_PAGES = 10;

export type ApprovedPaddleAdjustment = ProviderAdjustment;

export const PADDLE_OVERAGE_MARKER_KEY = "zenguy_overage_marker";

export type PaddleClient = BillingProviderClient;

export type PaddleFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type PaddleConfig = Pick<
  NonNullable<AppConfig["paddle"]>,
  "apiKey" | "apiBase"
>;

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

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : invalidResponse();
}

function unitPrice(value: unknown): {
  amount: string;
  currency_code: string;
} {
  const record = asRecord(value);
  return {
    amount: requiredString(record, "amount"),
    currency_code: requiredString(record, "currency_code"),
  };
}

function unitPriceOverrides(value: unknown): {
  country_codes: string[];
  unit_price: { amount: string; currency_code: string };
}[] {
  if (!Array.isArray(value)) return invalidResponse();
  return value.map((candidate) => {
    const record = asRecord(candidate);
    const countryCodes = record.country_codes;
    if (
      !Array.isArray(countryCodes) ||
      !countryCodes.every((code): code is string => typeof code === "string")
    ) {
      return invalidResponse();
    }
    return {
      country_codes: countryCodes,
      unit_price: unitPrice(record.unit_price),
    };
  });
}

function taxMode(value: unknown):
  | "account_setting"
  | "external"
  | "internal"
  | "location" {
  switch (value) {
    case "account_setting":
    case "external":
    case "internal":
    case "location":
      return value;
    default:
      return invalidResponse();
  }
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
    const apiBase = new URL(this.config.apiBase);
    const url = new URL(path, apiBase);
    if (url.origin !== apiBase.origin) return invalidResponse();
    const response = await this.fetchFn(url.toString(), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "Paddle-Version": "1",
        ...init.headers,
      },
      signal: externalProviderSignal(),
    });
    if (!response.ok) {
      logEvent("paddle_error", { status: response.status, endpoint });
      await cancelResponseBody(response);
      // Do not read or log Paddle's response body: it may contain PII.
      if (
        response.status === 403 &&
        endpoint === "prices.get_for_subscription_charge"
      ) {
        throw new Error("paddle price.read permission required");
      }
      if (response.status === 403 && endpoint === "adjustments.list") {
        throw new Error("paddle adjustment.read permission required");
      }
      throw new Error(`paddle error ${response.status}`);
    }
    return response;
  }

  async createOneTimeCharge(
    subscriptionId: string,
    priceId: string,
    quantity: number,
    marker: string,
  ): Promise<{ transactionId: string | null }> {
    // Paddle catalog charge items accept only price_id and quantity, so they
    // cannot carry a per-charge marker. Snapshot the configured catalog price
    // as an equivalent non-catalog price whose documented custom_data is
    // preserved on transaction.items[].price for later reconciliation.
    const priceResponse = await this.request(
      "prices.get_for_subscription_charge",
      `/prices/${encodeURIComponent(priceId)}`,
      { method: "GET" },
    );
    const pricePayload = await readLimitedJsonResponse(
      priceResponse,
      MAX_PADDLE_RESPONSE_BYTES,
    );
    const catalogPrice = asRecord(asRecord(pricePayload).data);
    if (catalogPrice.billing_cycle !== null) return invalidResponse();
    const catalogName = nullableString(catalogPrice, "name");
    const catalogUnitPrice = unitPrice(catalogPrice.unit_price);
    const catalogOverrides = unitPriceOverrides(
      catalogPrice.unit_price_overrides,
    );
    if (
      catalogUnitPrice.amount !== String(OVERAGE_CENTS_PER_RUN) ||
      catalogUnitPrice.currency_code !== "EUR" ||
      catalogOverrides.length !== 0
    ) {
      throw new Error("paddle overage price misconfigured");
    }
    const catalogCustomData = catalogPrice.custom_data;
    const customData =
      catalogCustomData === null
        ? {}
        : { ...asRecord(catalogCustomData) };

    const chargeResponse = await this.request(
      "subscriptions.charge",
      `/subscriptions/${encodeURIComponent(subscriptionId)}/charge`,
      {
        method: "POST",
        body: JSON.stringify({
          effective_from: "immediately",
          items: [
            {
              quantity,
              price: {
                product_id: requiredString(catalogPrice, "product_id"),
                description: requiredString(
                  catalogPrice,
                  "description",
                ).slice(0, 200),
                name: catalogName?.slice(0, 50) ?? null,
                tax_mode: taxMode(catalogPrice.tax_mode),
                unit_price: catalogUnitPrice,
                unit_price_overrides: catalogOverrides,
                quantity: { minimum: 1, maximum: 999_999_999 },
                custom_data: {
                  ...customData,
                  [PADDLE_OVERAGE_MARKER_KEY]: marker,
                },
              },
            },
          ],
        }),
      },
    );
    await cancelResponseBody(chargeResponse);

    // DEVIATION: the current Paddle API returns the updated subscription, not
    // the asynchronously-created transaction. Consumers discover that charge
    // through the transactions list, so the required nullable contract is null.
    return { transactionId: null };
  }

  async findSubscriptionChargeByMarker(
    subscriptionId: string,
    marker: string,
  ): Promise<{ transactionId: string } | null> {
    const query = new URLSearchParams({
      subscription_id: subscriptionId,
      origin: "subscription_charge",
      order_by: "id[DESC]",
      per_page: "30",
    });
    let path = `/transactions?${query.toString()}`;
    const seenPages = new Set<string>();

    for (;;) {
      if (seenPages.has(path) || seenPages.size >= MAX_PADDLE_PAGES) {
        return invalidResponse();
      }
      seenPages.add(path);
      const response = await this.request(
        "transactions.reconcile_subscription_charge",
        path,
        { method: "GET", headers: { "Skip-Count": "true" } },
      );
      const payload = await readLimitedJsonResponse(
        response,
        MAX_PADDLE_RESPONSE_BYTES,
      );
      const envelope = asRecord(payload);
      const data = envelope.data;
      if (!Array.isArray(data)) return invalidResponse();
      for (const value of data) {
        const transaction = asRecord(value);
        if (requiredString(transaction, "origin") !== "subscription_charge") {
          continue;
        }
        const items = transaction.items;
        if (!Array.isArray(items)) return invalidResponse();
        for (const item of items) {
          const price = asRecord(asRecord(item).price);
          const itemCustomData = price.custom_data;
          if (
            itemCustomData !== null &&
            asRecord(itemCustomData)[PADDLE_OVERAGE_MARKER_KEY] === marker
          ) {
            return { transactionId: requiredString(transaction, "id") };
          }
        }
      }

      const pagination = asRecord(asRecord(envelope.meta).pagination);
      if (!requiredBoolean(pagination, "has_more")) return null;
      const next = requiredString(pagination, "next");
      const nextUrl = new URL(next, this.config.apiBase);
      const apiBase = new URL(this.config.apiBase);
      if (
        nextUrl.origin !== apiBase.origin ||
        nextUrl.pathname !== "/transactions"
      ) {
        return invalidResponse();
      }
      path = nextUrl.toString();
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const response = await this.request(
      "subscriptions.cancel",
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ effective_from: "immediately" }),
      },
    );
    await cancelResponseBody(response);
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
    const payload = await readLimitedJsonResponse(
      response,
      MAX_PADDLE_RESPONSE_BYTES,
    );
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

  async getSubscriptionManagementUrls(
    subscriptionId: string,
  ): Promise<SubscriptionManagementUrls> {
    const response = await this.request(
      "subscriptions.get",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "GET" },
    );
    const payload = await readLimitedJsonResponse(
      response,
      MAX_PADDLE_RESPONSE_BYTES,
    );
    const data = asRecord(asRecord(payload).data);
    const managementUrls = asRecord(data.management_urls);
    return {
      updatePaymentMethodUrl: nullableString(
        managementUrls,
        "update_payment_method",
      ),
      cancelUrl: requiredString(managementUrls, "cancel"),
    };
  }

  async getInvoicePdfUrl(transactionId: string): Promise<string> {
    const response = await this.request(
      "transactions.invoice",
      `/transactions/${encodeURIComponent(transactionId)}/invoice`,
      { method: "GET" },
    );
    const payload = await readLimitedJsonResponse(
      response,
      MAX_PADDLE_RESPONSE_BYTES,
    );
    return requiredString(asRecord(asRecord(payload).data), "url");
  }

  async listApprovedAdjustments(
    transactionId: string,
  ): Promise<ApprovedPaddleAdjustment[]> {
    const query = new URLSearchParams({
      transaction_id: transactionId,
      status: "approved",
      order_by: "id[ASC]",
      per_page: "50",
    });
    let path = `/adjustments?${query.toString()}`;
    const seenPages = new Set<string>();
    const adjustments: ApprovedPaddleAdjustment[] = [];
    for (;;) {
      if (seenPages.has(path) || seenPages.size >= MAX_PADDLE_PAGES) {
        return invalidResponse();
      }
      seenPages.add(path);
      const response = await this.request("adjustments.list", path, {
        method: "GET",
        headers: { "Skip-Count": "true" },
      });
      const payload = await readLimitedJsonResponse(
        response,
        MAX_PADDLE_RESPONSE_BYTES,
      );
      const envelope = asRecord(payload);
      if (!Array.isArray(envelope.data)) return invalidResponse();
      for (const candidate of envelope.data) {
        const adjustment = asRecord(candidate);
        const totals = asRecord(adjustment.totals);
        if (
          requiredString(adjustment, "status") !== "approved" ||
          requiredString(adjustment, "transaction_id") !== transactionId
        ) {
          return invalidResponse();
        }
        adjustments.push({
          id: requiredString(adjustment, "id"),
          action: requiredString(adjustment, "action"),
          transactionId,
          customerId: requiredString(adjustment, "customer_id"),
          amountCents: minorUnits(requiredString(totals, "total")),
          currency: requiredString(adjustment, "currency_code"),
        });
      }
      const pagination = asRecord(asRecord(envelope.meta).pagination);
      if (!requiredBoolean(pagination, "has_more")) return adjustments;
      const nextUrl = new URL(requiredString(pagination, "next"), this.config.apiBase);
      const apiBase = new URL(this.config.apiBase);
      if (
        nextUrl.origin !== apiBase.origin ||
        nextUrl.pathname !== "/adjustments"
      ) {
        return invalidResponse();
      }
      path = nextUrl.toString();
    }
  }
}
