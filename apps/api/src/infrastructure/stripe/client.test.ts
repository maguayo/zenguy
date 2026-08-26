import type { StripeConfig } from "../../shared/config";
import { HttpStripeClient } from "./client";

const CONFIG: StripeConfig = {
  secretKey: "sk_test_example123",
  webhookSecret: "whsec_example123",
  environment: "test",
  productId: "prod_monthly",
  priceId: "price_monthly",
  overagePriceId: "price_overage",
  alertCreditProductId: "prod_alert",
  alertCreditPriceId: "price_alert",
  apiBase: "https://api.stripe.com",
};

function json(value: unknown): Response {
  return Response.json(value);
}

describe("HttpStripeClient", () => {
  it("creates a server-side subscription Checkout Session with pinned metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new HttpStripeClient(
      CONFIG,
      "https://app.zenguy.com",
      async (url, init = {}) => {
        calls.push({ url, init });
        return json({
          id: "cs_test_123",
          url: "https://checkout.stripe.com/c/pay/cs_test_123",
        });
      },
    );

    await expect(
      client.createCheckoutSession({
        intentId: "pci_123",
        purpose: "subscription",
        priceId: "price_monthly",
        quantity: 1,
        customerEmail: "owner@example.com",
        successUrl: "https://app.zenguy.com/w/ws_1/setup/billing?checkout=success",
        cancelUrl: "https://app.zenguy.com/w/ws_1/setup/billing?checkout=canceled",
        expiresAt: 1_800_000,
      }),
    ).resolves.toEqual({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer sk_test_example123",
      "Idempotency-Key": "zenguy-checkout-pci_123",
    });
    const body = call.init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_monthly",
      "line_items[0][quantity]": "1",
      customer_email: "owner@example.com",
      client_reference_id: "pci_123",
      "metadata[checkout_intent_id]": "pci_123",
      "subscription_data[metadata][checkout_intent_id]": "pci_123",
      "automatic_tax[enabled]": "true",
      "tax_id_collection[enabled]": "true",
    });
  });

  it("rejects a Checkout URL outside Stripe's exact host", async () => {
    const client = new HttpStripeClient(
      CONFIG,
      "https://app.zenguy.com",
      async () => json({
        id: "cs_test_123",
        url: "https://checkout.stripe.com.evil.test/cs_test_123",
      }),
    );

    await expect(
      client.createCheckoutSession({
        intentId: "pci_123",
        purpose: "alert_credit",
        priceId: "price_alert",
        quantity: 1,
        customerEmail: "owner@example.com",
        successUrl: "https://app.zenguy.com/success",
        cancelUrl: "https://app.zenguy.com/cancel",
        expiresAt: 1_800_000,
      }),
    ).rejects.toThrow("stripe response invalid");
  });

  it("creates and finalizes one idempotent overage invoice", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const responses = [
      { id: "price_overage", currency: "eur", unit_amount: 20, type: "one_time" },
      { id: "sub_1", customer: "cus_1" },
      { id: "in_1" },
      { id: "ii_1" },
      { id: "in_1", status: "open" },
    ];
    const client = new HttpStripeClient(
      CONFIG,
      "https://app.zenguy.com",
      async (url, init = {}) => {
        calls.push({ url, init });
        return json(responses.shift());
      },
    );

    await expect(
      client.createOneTimeCharge(
        "sub_1",
        "price_overage",
        3,
        "zenguy:overage:v1:ws_1:1000",
      ),
    ).resolves.toEqual({ transactionId: "in_1" });
    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.stripe.com/v1/prices/price_overage",
      "https://api.stripe.com/v1/subscriptions/sub_1",
      "https://api.stripe.com/v1/invoices",
      "https://api.stripe.com/v1/invoiceitems",
      "https://api.stripe.com/v1/invoices/in_1/finalize",
    ]);
    expect(calls.slice(2).map(({ init }) =>
      (init.headers as Record<string, string>)["Idempotency-Key"]
    )).toEqual([
      "zenguy:overage:v1:ws_1:1000:invoice",
      "zenguy:overage:v1:ws_1:1000:item",
      "zenguy:overage:v1:ws_1:1000:finalize",
    ]);
    expect(Object.fromEntries(calls[3]!.init.body as URLSearchParams)).toMatchObject({
      customer: "cus_1",
      invoice: "in_1",
      "pricing[price]": "price_overage",
      quantity: "3",
    });
  });
});
