import { isPricingPayload, PRICING_ENDPOINT } from "../lib/pricing.mjs";

const SELECTORS = Object.freeze({
  monthly: '[data-pricing-amount="monthly"]',
  overage: '[data-pricing-amount="overage"]',
});

export function applyPricing(root, pricing) {
  if (!isPricingPayload(pricing)) return false;

  for (const element of root.querySelectorAll(SELECTORS.monthly)) {
    element.textContent = pricing.monthlyDisplay;
  }
  for (const element of root.querySelectorAll(SELECTORS.overage)) {
    element.textContent = pricing.overageDisplay;
  }
  if (root.documentElement?.dataset) {
    root.documentElement.dataset.pricingCurrency = pricing.currency;
  }
  return true;
}

export async function loadPricing({
  fetchImpl = globalThis.fetch,
  root = globalThis.document,
} = {}) {
  if (typeof fetchImpl !== "function" || root?.querySelectorAll === undefined) {
    return false;
  }
  const response = await fetchImpl(PRICING_ENDPOINT, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return false;
  return applyPricing(root, await response.json());
}

if (typeof document !== "undefined") {
  void loadPricing().catch(() => false);
}
