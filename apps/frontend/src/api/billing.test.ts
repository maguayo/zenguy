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
    cancelUrl: "https://sandbox-vendors.paddle.com/cancel",
    periodEnd: "2026-09-01T00:00:00.000Z",
    periodStart: "2026-08-01T00:00:00.000Z",
    source: "paddle",
    status: "ACTIVE",
    updatePaymentMethodUrl: "https://sandbox-vendors.paddle.com/payment",
  },
  usage: {
    billableRuns: 10,
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
          clientToken: "test_token",
          environment: "sandbox",
          mode: "paddle",
          priceId: "pri_1",
        });
      }
      if (path.includes("/invoices/")) return response({ url: "https://paddle.test/invoice.pdf" });
      return response(billing);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBillingConfig()).resolves.toMatchObject({
      environment: "sandbox",
      mode: "paddle",
    });
    await expect(getBilling("ws/one")).resolves.toEqual(billing);
    await expect(getInvoiceUrl("ws/one", "txn two")).resolves.toBe(
      "https://paddle.test/invoice.pdf",
    );
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      "/api/billing/config",
      "/api/workspaces/ws%2Fone/billing",
      "/api/workspaces/ws%2Fone/billing/invoices/txn%20two/url",
    ]);
  });
});
