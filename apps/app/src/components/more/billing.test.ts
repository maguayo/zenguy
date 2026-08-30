import { describe, expect, it } from "@jest/globals";

import type { Billing } from "@/api/types";
import { formatCurrency } from "@/lib/format";
import {
  invoiceNumberLabel,
  invoiceStatus,
  invoiceTotalLabel,
  pastDueBanner,
  paymentWebNote,
  planPresentation,
  planPrice,
  subscriptionPeriod,
  subscriptionPresentation,
  webAppHost,
} from "./billing";

function billing(overrides: Partial<Billing["subscription"]> = {}): Billing {
  return {
    invoices: [],
    plan: { currency: "EUR", includedRuns: 300, overagePerRunCents: 20, pricePerMonthCents: 3_900 },
    subscription: {
      cancelAtPeriodEnd: false,
      cancelUrl: null,
      periodEnd: null,
      periodStart: null,
      source: "free",
      status: "ACTIVE",
      updatePaymentMethodUrl: null,
      ...overrides,
    },
    usage: {
      billableRuns: 12,
      currency: "EUR",
      includedRuns: 300,
      overageAmountCents: 0,
      overageRuns: 0,
      periodEnd: "2026-09-01T00:00:00.000Z",
      periodStart: "2026-08-01T00:00:00.000Z",
      projectedTotalCents: 0,
      remainingRuns: 288,
    },
  };
}

describe("billing presentation", () => {
  it("maps every subscription state to exact plan copy", () => {
    expect(subscriptionPresentation("ACTIVE")).toEqual({ label: "Active", tone: "ok" });
    expect(subscriptionPresentation("PAST_DUE")).toEqual({ label: "Past due", tone: "warn" });
    expect(subscriptionPresentation("CANCELED")).toEqual({ label: "Canceled", tone: "danger" });
    expect(subscriptionPresentation("NONE")).toEqual({ label: "Not set up", tone: "neutral" });
  });

  it("keeps ACTIVE presentation distinct from complimentary plan copy", () => {
    expect(subscriptionPresentation("ACTIVE")).not.toEqual({
      label: "Complimentary",
      tone: "ok",
    });
  });

  it("presents grandfathered access without payment controls", () => {
    expect(planPresentation("free", "ACTIVE", billing().plan)).toEqual({
      description:
        "Grandfathered workspace access · 300 browser runs each month · Unlimited members",
      label: "Legacy",
      name: "Zenguy — legacy access",
      paid: false,
      tone: "ok",
    });
    expect(planPresentation("grant", "ACTIVE", billing().plan)).toMatchObject({
      label: "Complimentary",
      name: "Zenguy — complimentary",
      paid: false,
    });
    expect(planPresentation("stripe", "ACTIVE", billing().plan)).toMatchObject({
      label: "Active",
      name: "Zenguy — 39,00 €/month",
      paid: true,
    });
    expect(
      planPresentation(undefined, "CANCELED", {
        ...billing().plan,
        currency: "USD",
      }),
    ).toMatchObject({ label: "Canceled", name: "Zenguy — $39.00/month", paid: true });
  });

  it("maps common invoice states", () => {
    expect(invoiceStatus("paid")).toEqual({ label: "Paid", tone: "ok" });
    expect(invoiceStatus("completed")).toEqual({ label: "Completed", tone: "ok" });
    expect(invoiceStatus("past_due")).toEqual({ label: "Past due", tone: "warn" });
    expect(invoiceStatus("pending")).toEqual({ label: "Pending", tone: "warn" });
    expect(invoiceStatus("failed")).toEqual({ label: "Failed", tone: "danger" });
    expect(invoiceStatus("canceled")).toEqual({ label: "Canceled", tone: "danger" });
    expect(invoiceStatus("draft")).toEqual({ label: "draft", tone: "neutral" });
    expect(
      invoiceNumberLabel({
        billedAt: null,
        currency: "EUR",
        id: "txn_1",
        invoiceNumber: null,
        status: "paid",
        totalCents: 4_140,
      }),
    ).toBe("—");
    expect(
      invoiceTotalLabel({
        billedAt: null,
        currency: "USD",
        id: "in_usd",
        invoiceNumber: "US-1",
        status: "paid",
        totalCents: 4_140,
      }),
    ).toBe("$41.40");
  });

  it("prices paid plans and labels included legacy access", () => {
    const eur = billing().plan;
    const usd = { ...eur, currency: "USD" as const };
    expect(planPrice(planPresentation("stripe", "ACTIVE", eur), eur)).toBe(
      `${formatCurrency(3_900, "EUR")} / month`,
    );
    expect(planPrice(planPresentation("stripe", "ACTIVE", usd), usd)).toBe("$39.00 / month");
    expect(planPrice(planPresentation("free", "ACTIVE", eur), eur)).toBe("Included");
    expect(planPrice(planPresentation("grant", "ACTIVE", eur), eur)).toBe("Included");
  });

  it("falls back to the usage cycle when the subscription has no provider period", () => {
    expect(subscriptionPeriod(billing())).toEqual({
      end: "2026-09-01T00:00:00.000Z",
      start: "2026-08-01T00:00:00.000Z",
    });
    expect(
      subscriptionPeriod(
        billing({
          periodEnd: "2026-09-19T00:00:00.000Z",
          periodStart: "2026-08-19T00:00:00.000Z",
          source: "stripe",
        }),
      ),
    ).toEqual({ end: "2026-09-19T00:00:00.000Z", start: "2026-08-19T00:00:00.000Z" });
  });

  it("points payment management to the web app without links", () => {
    expect(webAppHost).toBe("app.zenguy.com");
    expect(paymentWebNote).toBe(
      "Manage payment methods and cancellation from the web app at app.zenguy.com",
    );
  });

  it("shows the past-due banner only when the last payment failed", () => {
    expect(pastDueBanner("ACTIVE", true)).toBeNull();
    expect(pastDueBanner("NONE", true)).toBeNull();
    expect(pastDueBanner("PAST_DUE", true)).toEqual({
      action: "Manage your payment method from the web app at app.zenguy.com.",
      message: "Your last payment failed. Update your payment method to keep runs going.",
    });
    expect(pastDueBanner("PAST_DUE", false)?.action).toBe("Contact your workspace owner.");
  });
});
