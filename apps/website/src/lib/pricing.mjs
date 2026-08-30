export const PRICING_ENDPOINT = "/api/pricing";

const EUR_PRICING = Object.freeze({
  currency: "EUR",
  monthlyCents: 3_900,
  monthlyDisplay: "39 €",
  overageCents: 20,
  overageDisplay: "0,20 €",
});

const USD_PRICING = Object.freeze({
  currency: "USD",
  monthlyCents: 3_900,
  monthlyDisplay: "$39",
  overageCents: 20,
  overageDisplay: "$0.20",
});

export const PRICING_BY_CURRENCY = Object.freeze({
  EUR: EUR_PRICING,
  USD: USD_PRICING,
});

export function pricingForCurrency(currency) {
  return PRICING_BY_CURRENCY[currency] ?? EUR_PRICING;
}

export function isPricingPayload(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const expected = PRICING_BY_CURRENCY[value.currency];
  if (expected === undefined) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  return expectedKeys.every((key) => value[key] === expected[key]);
}
