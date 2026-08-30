import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BillingPlanPrice, Invoice } from "../../api/types";
import {
  invoiceColumns,
  invoiceStatus,
  planPresentation,
  subscriptionPresentation,
} from "./BillingPage";

const invoice: Invoice = {
  billedAt: "2026-08-01T10:00:00.000Z",
  currency: "EUR",
  id: "txn_1",
  invoiceNumber: "INV-001",
  status: "paid",
  totalCents: 4_140,
};
const eurPlan: BillingPlanPrice = {
  currency: "EUR",
  overagePerRunCents: 20,
  pricePerMonthCents: 3_900,
};

describe("billing page", () => {
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
    expect(planPresentation("free", "ACTIVE", eurPlan)).toEqual({
      description:
        "Grandfathered workspace access · 300 browser runs each month · Unlimited members",
      label: "Legacy",
      name: "Zenguy — legacy access",
      paid: false,
      tone: "ok",
    });
    expect(planPresentation("paddle", "ACTIVE", eurPlan)).toMatchObject({
      name: "Zenguy — 39,00 €/month",
      paid: true,
    });
    expect(
      planPresentation("stripe", "ACTIVE", { ...eurPlan, currency: "USD" }),
    ).toMatchObject({
      description: "300 runs included · $0.20 per extra run · Unlimited members",
      name: "Zenguy — $39.00/month",
    });
  });

  it("maps common invoice states and renders invoice columns", () => {
    expect(invoiceStatus("paid")).toEqual({ label: "Paid", tone: "ok" });
    expect(invoiceStatus("past_due")).toEqual({ label: "Past due", tone: "warn" });
    expect(invoiceStatus("failed")).toEqual({ label: "Failed", tone: "danger" });
    const columns = invoiceColumns("UTC");
    expect(columns.map((column) => column.key)).toEqual([
      "date",
      "number",
      "total",
      "status",
      "actions",
    ]);
    const html = renderToStaticMarkup(
      <>{columns.map((column) => <div key={column.key}>{column.render(invoice)}</div>)}</>,
    );
    expect(html).toContain("1 Aug 2026, 10:00");
    expect(html).toContain("INV-001");
    expect(html).toContain("41,40");
    expect(html).toContain("Paid");

    const usdColumns = invoiceColumns("UTC");
    const usdHtml = renderToStaticMarkup(
      <>{usdColumns.map((column) => (
        <div key={column.key}>{column.render({ ...invoice, currency: "USD" })}</div>
      ))}</>,
    );
    expect(usdHtml).toContain("$41.40");
  });
});
