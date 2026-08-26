import type { Billing, Invoice, SubscriptionSource, SubscriptionStatus } from "@/api/types";
import { APP_WEB_URL } from "@/lib/config";
import { formatEuros } from "@/lib/format";
import type { Tone } from "@/theme";

export interface SubscriptionPresentation {
  label: string;
  tone: Tone;
}

export function subscriptionPresentation(status: SubscriptionStatus): SubscriptionPresentation {
  switch (status) {
    case "ACTIVE":
      return { label: "Active", tone: "ok" };
    case "PAST_DUE":
      return { label: "Past due", tone: "warn" };
    case "CANCELED":
      return { label: "Canceled", tone: "danger" };
    case "NONE":
      return { label: "Not set up", tone: "neutral" };
  }
}

export function invoiceStatus(status: string): SubscriptionPresentation {
  const normalized = status.toUpperCase();
  if (normalized === "PAID" || normalized === "COMPLETED") {
    return { label: normalized === "PAID" ? "Paid" : "Completed", tone: "ok" };
  }
  if (normalized === "PAST_DUE" || normalized === "PENDING") {
    return { label: normalized === "PAST_DUE" ? "Past due" : "Pending", tone: "warn" };
  }
  if (normalized === "FAILED" || normalized === "CANCELED") {
    return { label: normalized === "FAILED" ? "Failed" : "Canceled", tone: "danger" };
  }
  return { label: status, tone: "neutral" };
}

export interface PlanPresentation extends SubscriptionPresentation {
  description: string;
  name: string;
  paid: boolean;
}

export function planPresentation(
  source: SubscriptionSource | undefined,
  status: SubscriptionStatus,
): PlanPresentation {
  if (source === "free") {
    return {
      description:
        "Grandfathered workspace access · 300 browser runs each month · Unlimited members",
      label: "Legacy",
      name: "Zenguy — legacy access",
      paid: false,
      tone: "ok",
    };
  }
  if (source === "grant") {
    return {
      description: "300 runs included · extra runs are not billed · Unlimited members",
      label: "Complimentary",
      name: "Zenguy — complimentary",
      paid: false,
      tone: "ok",
    };
  }
  const subscription = subscriptionPresentation(status);
  return {
    ...subscription,
    description: "300 runs included · 0,20 € per extra run · Unlimited members",
    name: "Zenguy — 39 €/month",
    paid: true,
  };
}

/** The web app host shown in "manage it on the web" notes (no link). */
export const webAppHost = APP_WEB_URL.replace(/^https?:\/\//u, "");

/** Replaces the web's payment card: there is no checkout or cancellation in the app. */
export const paymentWebNote = `Manage payment methods and cancellation from the web app at ${webAppHost}`;

export const paymentOwnerOnlyNote = "Only the owner can manage the subscription.";

export function planPrice(plan: PlanPresentation, pricePerMonthCents: number): string {
  return plan.paid ? `${formatEuros(pricePerMonthCents)} / month` : "Included";
}

export interface BillingPeriod {
  end: string;
  start: string;
}

/**
 * Paid subscriptions carry a provider period; legacy and complimentary ones
 * reset on the usage cycle instead.
 */
export function subscriptionPeriod(billing: Billing): BillingPeriod {
  const { periodEnd, periodStart } = billing.subscription;
  if (periodStart && periodEnd) return { end: periodEnd, start: periodStart };
  return { end: billing.usage.periodEnd, start: billing.usage.periodStart };
}

export function invoiceNumberLabel(invoice: Invoice): string {
  return invoice.invoiceNumber ?? "—";
}

export interface PastDueBanner {
  action: string;
  message: string;
}

/** The web AppLayout banner, minus its "Update payment" link. */
export function pastDueBanner(
  status: SubscriptionStatus,
  canManageBilling: boolean,
): PastDueBanner | null {
  if (status !== "PAST_DUE") return null;
  return {
    action: canManageBilling
      ? `Manage your payment method from the web app at ${webAppHost}.`
      : "Contact your workspace owner.",
    message: "Your last payment failed. Update your payment method to keep runs going.",
  };
}
