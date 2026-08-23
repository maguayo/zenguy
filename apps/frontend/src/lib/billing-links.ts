const BILLING_HOSTS = new Set([
  "customer-portal.paddle.com",
  "invoicedata.paddle.com",
  "sandbox-customer-portal.paddle.com",
  "sandbox-invoicedata.paddle.com",
  "sandbox-vendors.paddle.com",
  "vendors.paddle.com",
]);

/** Accept only HTTPS documents and management pages controlled by Paddle. */
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
