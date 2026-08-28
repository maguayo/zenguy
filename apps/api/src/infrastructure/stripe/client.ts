import type { CheckoutPurpose } from "../../domain/billing/types";
import type { StripeConfig } from "../../shared/config";
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

const MAX_STRIPE_RESPONSE_BYTES = 1_024 * 1_024;
const STRIPE_API_VERSION = "2026-07-29.dahlia";
export const STRIPE_OVERAGE_MARKER_KEY = "zenguy_overage_marker";

type StripeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type FormEntry = readonly [string, string | number | boolean];

export interface CreateStripeCheckoutInput {
  intentId: string;
  purpose: CheckoutPurpose;
  priceId: string;
  quantity: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

function invalidResponse(): never {
  throw new Error("stripe response invalid");
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
  return typeof value === "string" && value.length > 0
    ? value
    : invalidResponse();
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  return typeof value === "string" ? value : invalidResponse();
}

function requiredInteger(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  return Number.isSafeInteger(value) ? (value as number) : invalidResponse();
}

function expandableId(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  return requiredString(asRecord(value), "id");
}

function formBody(entries: readonly FormEntry[]): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of entries) body.append(key, String(value));
  return body;
}

function assertHostedUrl(raw: string, hostname: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== hostname ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return invalidResponse();
  }
  return url.toString();
}

/**
 * Fixed vocabulary of failure shapes for `stripe_request_failed` logs. Only
 * the matched tag is ever logged — raw error text may embed request data.
 */
const REQUEST_FAILURE_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["illegal_invocation", /illegal invocation/i],
  ["invalid_redirect", /invalid redirect/i],
  ["invalid_header", /invalid header/i],
  ["byte_string", /bytestring/i],
  ["timed_out", /abort|timed?\s?out/i],
];

export function classifyRequestFailure(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : "";
  for (const [tag, pattern] of REQUEST_FAILURE_PATTERNS) {
    if (pattern.test(text)) return tag;
  }
  return "unmatched";
}

export class HttpStripeClient implements BillingProviderClient {
  constructor(
    private readonly config: StripeConfig,
    private readonly appUrl: string,
    // Wrapped instead of referencing the global directly: workerd can enforce
    // the receiver on global fetch, and `this.fetchFn(...)` with the unbound
    // function then throws "Illegal invocation" before dispatching anything.
    private readonly fetchFn: StripeFetch = (input, init) => fetch(input, init),
  ) {}

  private async request(
    operation: string,
    path: string,
    init: {
      method: "GET" | "POST" | "DELETE";
      body?: URLSearchParams;
      idempotencyKey?: string;
    },
  ): Promise<Response> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.apiBase}/v1${path}`, {
        method: init.method,
        body: init.body,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": STRIPE_API_VERSION,
          ...(init.idempotencyKey === undefined
            ? {}
            : { "Idempotency-Key": init.idempotencyKey }),
        },
        // workerd's fetch rejects `redirect: "error"` with a synchronous
        // TypeError; "manual" keeps the same posture because a 3xx surfaces
        // below as !response.ok and fails the request instead of following.
        redirect: "manual",
        signal: externalProviderSignal(),
      });
    } catch (error) {
      logEvent("stripe_request_failed", {
        operation,
        durationMs: Date.now() - startedAt,
        // Name and fixed pattern tag only: provider/runtime error messages
        // may embed request data, so raw text never reaches the log.
        errorName: error instanceof Error ? error.name : "unknown",
        errorPattern: classifyRequestFailure(error),
      });
      throw error;
    }
    logEvent("stripe_request", {
      operation,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`stripe request failed (${operation}): ${response.status}`);
    }
    return response;
  }

  private async requestJson(
    operation: string,
    path: string,
    init: {
      method: "GET" | "POST" | "DELETE";
      body?: URLSearchParams;
      idempotencyKey?: string;
    },
  ): Promise<Record<string, unknown>> {
    const response = await this.request(operation, path, init);
    return asRecord(
      await readLimitedJsonResponse(response, MAX_STRIPE_RESPONSE_BYTES),
    );
  }

  async createCheckoutSession(
    input: CreateStripeCheckoutInput,
  ): Promise<StripeCheckoutSession> {
    const entries: FormEntry[] = [
      ["mode", input.purpose === "subscription" ? "subscription" : "payment"],
      ["line_items[0][price]", input.priceId],
      ["line_items[0][quantity]", input.quantity],
      ["success_url", input.successUrl],
      ["cancel_url", input.cancelUrl],
      ["customer_email", input.customerEmail],
      ["client_reference_id", input.intentId],
      ["expires_at", Math.floor(input.expiresAt / 1_000)],
      ["automatic_tax[enabled]", true],
      ["billing_address_collection", "required"],
      ["tax_id_collection[enabled]", true],
      ["metadata[checkout_intent_id]", input.intentId],
      ["metadata[purpose]", input.purpose],
    ];
    if (input.purpose === "subscription") {
      entries.push(
        ["subscription_data[metadata][checkout_intent_id]", input.intentId],
        ["subscription_data[metadata][purpose]", input.purpose],
      );
    } else {
      entries.push(
        ["customer_creation", "always"],
        ["payment_intent_data[metadata][checkout_intent_id]", input.intentId],
        ["payment_intent_data[metadata][purpose]", input.purpose],
      );
    }
    const payload = await this.requestJson(
      "checkout.sessions.create",
      "/checkout/sessions",
      {
        method: "POST",
        body: formBody(entries),
        idempotencyKey: `zenguy-checkout-${input.intentId}`,
      },
    );
    return {
      id: requiredString(payload, "id"),
      url: assertHostedUrl(requiredString(payload, "url"), "checkout.stripe.com"),
    };
  }

  private async subscription(subscriptionId: string): Promise<Record<string, unknown>> {
    return this.requestJson(
      "subscriptions.retrieve",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "GET" },
    );
  }

  async createOneTimeCharge(
    subscriptionId: string,
    priceId: string,
    quantity: number,
    marker: string,
  ): Promise<{ transactionId: string | null }> {
    const price = await this.requestJson(
      "prices.retrieve_overage",
      `/prices/${encodeURIComponent(priceId)}`,
      { method: "GET" },
    );
    if (
      requiredString(price, "currency").toUpperCase() !== "EUR" ||
      requiredInteger(price, "unit_amount") !== OVERAGE_CENTS_PER_RUN ||
      price.type !== "one_time"
    ) {
      throw new Error("stripe overage price misconfigured");
    }
    const subscription = await this.subscription(subscriptionId);
    const customerId = expandableId(subscription.customer);
    const invoice = await this.requestJson(
      "invoices.create_overage",
      "/invoices",
      {
        method: "POST",
        body: formBody([
          ["customer", customerId],
          ["subscription", subscriptionId],
          ["collection_method", "charge_automatically"],
          ["auto_advance", false],
          ["pending_invoice_items_behavior", "exclude"],
          ["automatic_tax[enabled]", true],
          [`metadata[${STRIPE_OVERAGE_MARKER_KEY}]`, marker],
        ]),
        idempotencyKey: `${marker}:invoice`,
      },
    );
    const invoiceId = requiredString(invoice, "id");
    const itemResponse = await this.request(
      "invoiceitems.create_overage",
      "/invoiceitems",
      {
        method: "POST",
        body: formBody([
          ["customer", customerId],
          ["invoice", invoiceId],
          ["pricing[price]", priceId],
          ["quantity", quantity],
          [`metadata[${STRIPE_OVERAGE_MARKER_KEY}]`, marker],
        ]),
        idempotencyKey: `${marker}:item`,
      },
    );
    await cancelResponseBody(itemResponse);
    const finalized = await this.requestJson(
      "invoices.finalize_overage",
      `/invoices/${encodeURIComponent(invoiceId)}/finalize`,
      {
        method: "POST",
        body: formBody([["auto_advance", true]]),
        idempotencyKey: `${marker}:finalize`,
      },
    );
    return { transactionId: requiredString(finalized, "id") };
  }

  async findSubscriptionChargeByMarker(
    subscriptionId: string,
    marker: string,
  ): Promise<{ transactionId: string } | null> {
    const query = new URLSearchParams({
      subscription: subscriptionId,
      limit: "100",
    });
    const payload = await this.requestJson(
      "invoices.reconcile_overage",
      `/invoices?${query.toString()}`,
      { method: "GET" },
    );
    const invoices = payload.data;
    if (!Array.isArray(invoices)) return invalidResponse();
    for (const value of invoices) {
      const invoice = asRecord(value);
      const metadata = asRecord(invoice.metadata);
      if (metadata[STRIPE_OVERAGE_MARKER_KEY] === marker) {
        return { transactionId: requiredString(invoice, "id") };
      }
    }
    return null;
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const response = await this.request(
      "subscriptions.cancel",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "DELETE", idempotencyKey: `zenguy-cancel-${subscriptionId}` },
    );
    await cancelResponseBody(response);
  }

  async listBilledTransactions(
    subscriptionId: string,
    limit = 12,
  ): Promise<BilledTransaction[]> {
    const query = new URLSearchParams({
      subscription: subscriptionId,
      limit: String(limit),
    });
    const payload = await this.requestJson(
      "invoices.list",
      `/invoices?${query.toString()}`,
      { method: "GET" },
    );
    const data = payload.data;
    if (!Array.isArray(data)) return invalidResponse();
    return data.map((value) => {
      const invoice = asRecord(value);
      const created = requiredInteger(invoice, "created");
      return {
        id: requiredString(invoice, "id"),
        billedAt: new Date(created * 1_000).toISOString(),
        status: nullableString(invoice, "status") ?? "unknown",
        totalCents: requiredInteger(invoice, "total"),
        currency: requiredString(invoice, "currency").toUpperCase(),
        invoiceNumber: nullableString(invoice, "number"),
      };
    });
  }

  async getSubscriptionManagementUrls(
    subscriptionId: string,
  ): Promise<SubscriptionManagementUrls> {
    const subscription = await this.subscription(subscriptionId);
    const session = await this.requestJson(
      "billing_portal.sessions.create",
      "/billing_portal/sessions",
      {
        method: "POST",
        body: formBody([
          ["customer", expandableId(subscription.customer)],
          ["return_url", this.appUrl],
        ]),
      },
    );
    const url = assertHostedUrl(
      requiredString(session, "url"),
      "billing.stripe.com",
    );
    return { updatePaymentMethodUrl: url, cancelUrl: url };
  }

  async getInvoicePdfUrl(invoiceId: string): Promise<string> {
    const invoice = await this.requestJson(
      "invoices.retrieve_pdf",
      `/invoices/${encodeURIComponent(invoiceId)}`,
      { method: "GET" },
    );
    const raw = requiredString(invoice, "invoice_pdf");
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !["invoice.stripe.com", "pay.stripe.com"].includes(url.hostname) ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return invalidResponse();
    }
    return url.toString();
  }

  async listApprovedAdjustments(
    paymentIntentId: string,
  ): Promise<ProviderAdjustment[]> {
    const paymentIntent = await this.requestJson(
      "payment_intents.retrieve_for_refunds",
      `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      { method: "GET" },
    );
    const customerId = expandableId(paymentIntent.customer);
    const query = new URLSearchParams({
      payment_intent: paymentIntentId,
      limit: "100",
    });
    const payload = await this.requestJson(
      "refunds.list",
      `/refunds?${query.toString()}`,
      { method: "GET" },
    );
    const data = payload.data;
    if (!Array.isArray(data)) return invalidResponse();
    return data.flatMap((value): ProviderAdjustment[] => {
      const refund = asRecord(value);
      if (refund.status !== "succeeded") return [];
      return [{
        id: requiredString(refund, "id"),
        action: "refund",
        transactionId: expandableId(refund.payment_intent),
        customerId,
        amountCents: requiredInteger(refund, "amount"),
        currency: requiredString(refund, "currency").toUpperCase(),
      }];
    });
  }
}
