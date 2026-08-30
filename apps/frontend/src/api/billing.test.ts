import { afterEach, describe, expect, it, vi } from "vitest";

import type { Billing } from "./types";
import { getBilling, getBillingConfig, getInvoiceUrl } from "./billing";

const billing: Billing = {
  invoices: [],
  plan: {
    currency: "EUR",
    includedRuns: 300,
    overagePerRunCents: 20,
    pricePerMonthCents: 3_900,
  },
  subscription: {
    cancelAtPeriodEnd: false,
    cancelUrl: "https://billing.stripe.com/p/session/cancel",
    periodEnd: "2026-09-01T00:00:00.000Z",
    periodStart: "2026-08-01T00:00:00.000Z",
    source: "stripe",
    status: "ACTIVE",
    updatePaymentMethodUrl: "https://billing.stripe.com/p/session/payment",
  },
  usage: {
    billableRuns: 10,
    currency: "EUR",
    includedRuns: 300,
    overageAmountCents: 0,
    overageRuns: 0,
    periodEnd: "2026-09-01T00:00:00.000Z",
    periodStart: "2026-08-01T00:00:00.000Z",
    projectedTotalCents: 3_900,
    remainingRuns: 290,
  },
};

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("billing API", () => {
  it("gets config, workspace billing, and an encoded invoice URL", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const path = String(request);
      if (path.endsWith("/billing/config")) {
        return response({
          canIssueComplimentaryGrants: false,
          environment: "test",
          mode: "stripe",
          plan: {
            currency: "USD",
            overagePerRunCents: 20,
            pricePerMonthCents: 3_900,
          },
        });
      }
      if (path.includes("/invoices/")) return response({ url: "https://invoice.stripe.com/i/in_1.pdf" });
      return response(billing);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBillingConfig()).resolves.toMatchObject({
      environment: "test",
      mode: "stripe",
      plan: {
        currency: "USD",
        overagePerRunCents: 20,
        pricePerMonthCents: 3_900,
      },
    });
    await expect(getBilling("ws/one")).resolves.toEqual(billing);
    await expect(getInvoiceUrl("ws/one", "txn two")).resolves.toBe(
      "https://invoice.stripe.com/i/in_1.pdf",
    );
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      "/api/billing/config",
      "/api/workspaces/ws%2Fone/billing",
      "/api/workspaces/ws%2Fone/billing/invoices/txn%20two/url",
    ]);
  });
});
