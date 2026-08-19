import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Billing } from "../../api/types";
import { PlanDetails, pollUntilActive } from "./BillingSetup";

function billing(status: Billing["subscription"]["status"]): Billing {
  return {
    invoices: [],
    plan: {
      currency: "EUR",
      includedRuns: 300,
      overagePerRunCents: 20,
      pricePerMonthCents: 3900,
    },
    subscription: {
      cancelAtPeriodEnd: false,
      cancelUrl: null,
      periodEnd: null,
      periodStart: null,
      status,
      updatePaymentMethodUrl: null,
    },
    usage: {
      billableRuns: 0,
      includedRuns: 300,
      overageAmountCents: 0,
      overageRuns: 0,
      periodEnd: "2026-09-19T00:00:00.000Z",
      periodStart: "2026-08-19T00:00:00.000Z",
      projectedTotalCents: 3900,
      remainingRuns: 300,
    },
  };
}

describe("billing onboarding", () => {
  it("renders the complete plan promise", () => {
    const html = renderToStaticMarkup(<PlanDetails />);
    for (const copy of [
      "39 €",
      "300 browser test runs included",
      "0,20 € per additional run",
      "Unlimited team members",
      "Uptime checks — free, unlimited",
      "30-day run history &amp; evidence",
      "Retries don&#x27;t consume runs.",
    ]) {
      expect(html).toContain(copy);
    }
  });

  it("polls until the subscription becomes active", async () => {
    const fetchBilling = vi
      .fn<() => Promise<Billing>>()
      .mockResolvedValueOnce(billing("NONE"))
      .mockResolvedValueOnce(billing("ACTIVE"));
    const wait = vi.fn(async () => undefined);

    await expect(pollUntilActive(fetchBilling, { maxChecks: 3, wait })).resolves.toBe(true);
    expect(fetchBilling).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(2_000);
  });

  it("returns a recoverable timeout after the configured checks", async () => {
    const fetchBilling = vi.fn(async () => billing("NONE"));
    await expect(
      pollUntilActive(fetchBilling, { maxChecks: 2, wait: async () => undefined }),
    ).resolves.toBe(false);
    expect(fetchBilling).toHaveBeenCalledTimes(2);
  });
});
