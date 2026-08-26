const BILLING_HOSTS = new Set([
  "billing.stripe.com",
  "checkout.stripe.com",
  "invoice.stripe.com",
  "pay.stripe.com",
]);

/** Accept only HTTPS checkout, invoice and management pages controlled by a provider. */
export function trustedBillingUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (!BILLING_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function openTrustedBillingUrl(value: string): boolean {
  const trusted = trustedBillingUrl(value);
  if (!trusted || typeof window === "undefined") return false;
  const opened = window.open(trusted, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
  return true;
}
