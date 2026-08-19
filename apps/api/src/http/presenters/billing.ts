import type { BillingDetails } from "../../application/billing/get_billing";

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function presentBilling(billing: BillingDetails) {
  return {
    ...billing,
    subscription: {
      ...billing.subscription,
      periodStart:
        billing.subscription.periodStart === null
          ? null
          : iso(billing.subscription.periodStart),
      periodEnd:
        billing.subscription.periodEnd === null
          ? null
          : iso(billing.subscription.periodEnd),
    },
    usage: {
      ...billing.usage,
      periodStart: iso(billing.usage.periodStart),
      periodEnd: iso(billing.usage.periodEnd),
    },
  };
}
