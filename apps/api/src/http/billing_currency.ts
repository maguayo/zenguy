import type { BillingCurrency } from "../domain/billing/types";

const EU_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

interface CloudflareLocation {
  isEUCountry?: string | boolean | null;
  country?: string | null;
}

/**
 * Selects billing currency from Cloudflare's trusted request metadata. Local
 * requests have no `cf` signal and intentionally retain the historical EUR.
 */
export function billingCurrencyForRequest(request: Request): BillingCurrency {
  const cloudflare = (request as Request & { cf?: CloudflareLocation }).cf;
  if (cloudflare?.isEUCountry === "1" || cloudflare?.isEUCountry === true) {
    return "EUR";
  }
  if (cloudflare?.isEUCountry === "0" || cloudflare?.isEUCountry === false) {
    return "USD";
  }

  const country = (
    cloudflare?.country ?? request.headers.get("CF-IPCountry")
  )?.trim().toUpperCase();
  if (country === undefined || country === "") return "EUR";
  return EU_COUNTRY_CODES.has(country) ? "EUR" : "USD";
}
