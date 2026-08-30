import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Billing, BillingPlanPrice } from "../../api/types";
import {
  ActionErrorNotice,
  PlanDetails,
  pollForCorrelatedPurchase,
  pollUntilActive,
  shouldCheckCheckoutActivation,
} from "./BillingSetup";

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
      currency: "EUR",
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
  it("waits for billing configuration before checking a successful checkout", () => {
    expect(shouldCheckCheckoutActivation("success", undefined)).toBe(false);
    expect(shouldCheckCheckoutActivation("success", "test")).toBe(true);
    expect(shouldCheckCheckoutActivation("success", "live")).toBe(true);
    expect(shouldCheckCheckoutActivation(null, "live")).toBe(false);
  });

  it("renders the complete plan promise", () => {
    const eurPlan: BillingPlanPrice = {
      currency: "EUR",
      overagePerRunCents: 20,
      pricePerMonthCents: 3_900,
    };
    const html = renderToStaticMarkup(<PlanDetails plan={eurPlan} />);
    for (const copy of [
      "39,00 €",
      "300 browser test runs included",
      "0,20 € per additional run",
      "Unlimited team members",
      "Uptime checks — free, unlimited",
      "30-day run history &amp; evidence",
      "Retries don&#x27;t consume runs.",
    ]) {
      expect(html).toContain(copy);
    }

    const usd = renderToStaticMarkup(
      <PlanDetails plan={{ ...eurPlan, currency: "USD" }} />,
    );
    expect(usd).toContain("$39.00");
    expect(usd).toContain("$0.20 per additional run");
  });

  it("announces a failed action inline instead of relying on a toast", () => {
    const html = renderToStaticMarkup(
      <ActionErrorNotice message="Internal error" />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Internal error");
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

  it("retries delayed invoice evidence without blocking subscription activation", async () => {
    const checkoutStartedAt = Date.parse("2026-08-30T11:50:00.000Z");
    const activeWithoutInvoice = {
      ...billing("ACTIVE"),
      subscription: {
        ...billing("ACTIVE").subscription,
        source: "stripe" as const,
        periodStart: "2026-08-30T11:54:00.000Z",
      },
    };
    const activeWithInvoice = {
      ...activeWithoutInvoice,
      invoices: [
        {
          billedAt: "2026-08-30T11:55:00.000Z",
          currency: "EUR" as const,
          id: "in_123",
          invoiceNumber: null,
          status: "paid",
          totalCents: 4_719,
        },
      ],
    };
    const fetchBilling = vi.fn(async () => activeWithInvoice);
    await expect(
      pollForCorrelatedPurchase(
        activeWithoutInvoice,
        fetchBilling,
        checkoutStartedAt,
        {
          maxChecks: 2,
          now: () => Date.parse("2026-08-30T12:00:00.000Z"),
          wait: async () => undefined,
        },
      ),
    ).resolves.toEqual(activeWithInvoice);
    expect(fetchBilling).toHaveBeenCalledOnce();
  });
});
