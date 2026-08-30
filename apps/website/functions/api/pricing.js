import { pricingForCurrency } from "../../src/lib/pricing.mjs";

const EU_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

export function pricingCurrencyForCf(cf) {
  if (cf?.isEUCountry === "1") return "EUR";
  if (cf?.isEUCountry === "0" || cf?.isEUCountry === false) return "USD";
  if (typeof cf?.country === "string" && cf.country.length > 0) {
    return EU_COUNTRY_CODES.has(cf.country.toUpperCase()) ? "EUR" : "USD";
  }
  // Astro's local server and direct origin requests have no Cloudflare
  // geolocation metadata. Keep the static EUR price as the safe fallback.
  return "EUR";
}

export function onRequestGet({ request }) {
  const pricing = pricingForCurrency(pricingCurrencyForCf(request.cf));
  return Response.json(pricing, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
