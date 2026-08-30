import type { StripeConfig } from "../../shared/config";
import { classifyRequestFailure, HttpStripeClient } from "./client";

// Regression coverage for the production checkout outage: workerd validates
// RequestInit more strictly than Node's undici (`redirect: "error"` is
// rejected at the edge with a synchronous TypeError before any I/O). The unit
// suite runs on Node and its stub fetchFn skips that validation entirely, so
// these tests run on the workers runtime and force every RequestInit the
// client builds through workerd's real `new Request(...)` parsing.
const CONFIG: StripeConfig = {
  environment: "test",
  secretKey: "sk_test_itest",
  webhookSecret: "whsec_itest",
  productId: "prod_itest",
  priceId: "price_itest",
  overagePriceId: "price_overage_itest",
  alertCreditPriceId: null,
  alertCreditProductId: null,
  apiBase: "https://api.stripe.com",
};

const CHECKOUT_INPUT = {
  intentId: "pci_itest_1",
  purpose: "subscription" as const,
  priceId: CONFIG.priceId,
  quantity: 1,
  customerEmail: "owner@billing.test",
  successUrl: "https://app.zenguy.com/w/ws_1/setup/billing?checkout=success",
  cancelUrl: "https://app.zenguy.com/w/ws_1/setup/billing?checkout=canceled",
  expiresAt: Date.parse("2026-08-28T18:00:00Z"),
  currencyCode: "EUR" as const,
};

function subscriptionPriceResponse(): Response {
  return new Response(
    JSON.stringify({
      id: CONFIG.priceId,
      product: CONFIG.productId,
      currency: "eur",
      unit_amount: 3_900,
      currency_options: { usd: { unit_amount: 3_900 } },
      type: "recurring",
      recurring: { interval: "month" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function clientReplying(
  respond: (request: Request) => Response,
  seen: Request[] = [],
): HttpStripeClient {
  return new HttpStripeClient(
    CONFIG,
    "https://app.zenguy.com",
    async (input, init) => {
      // workerd applies the same RequestInit validation here that a real
      // outbound fetch dispatch would, without leaving the test runtime.
      const request = new Request(input, init);
      seen.push(request);
      return respond(request);
    },
  );
}

describe("HttpStripeClient RequestInit on the workers runtime", () => {
  it("builds a checkout request that workerd accepts and parses the session", async () => {
    const seen: Request[] = [];
    const client = clientReplying(
      (request) =>
        request.url.includes("/v1/prices/")
          ? subscriptionPriceResponse()
          : new Response(
              JSON.stringify({
                id: "cs_test_itest",
                url: "https://checkout.stripe.com/c/pay/cs_test_itest",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
      seen,
    );

    const session = await client.createCheckoutSession(CHECKOUT_INPUT);

    expect(session).toEqual({
      id: "cs_test_itest",
      url: "https://checkout.stripe.com/c/pay/cs_test_itest",
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.url).toContain("/v1/prices/price_itest?");
    const request = seen[1]!;
    expect(request.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(request.headers.get("authorization")).toBe(
      `Bearer ${CONFIG.secretKey}`,
    );
    expect(request.redirect).toBe("manual");
    const body = new URLSearchParams(await request.text());
    expect(body.get("line_items[0][price]")).toBe(CONFIG.priceId);
    expect(body.get("client_reference_id")).toBe(CHECKOUT_INPUT.intentId);
  });

  it("dispatches through the DEFAULT fetchFn without tripping init validation", async () => {
    // The production outage came from the default path (no injected fetchFn):
    // workerd rejected the unbound global fetch / its RequestInit before any
    // I/O. Point the client at a reserved TLD so a request that passes
    // validation can only fail on DNS — which classifies as "unmatched",
    // never as one of the known init-validation failures.
    const client = new HttpStripeClient(
      { ...CONFIG, apiBase: "https://stripe.invalid" as StripeConfig["apiBase"] },
      "https://app.zenguy.com",
    );
    let caught: unknown = null;
    try {
      await client.createCheckoutSession(CHECKOUT_INPUT);
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught).not.toBeInstanceOf(TypeError);
    expect(classifyRequestFailure(caught)).toBe("unmatched");
  });

  it("treats a redirect response as a failed request, not a hop to follow", async () => {
    const client = clientReplying(
      (request) =>
        request.url.includes("/v1/prices/")
          ? subscriptionPriceResponse()
          : new Response(null, {
              status: 302,
              headers: { location: "https://evil.example/steal" },
            }),
    );

    await expect(client.createCheckoutSession(CHECKOUT_INPUT)).rejects.toThrow(
      "stripe request failed (checkout.sessions.create): 302",
    );
  });
});
