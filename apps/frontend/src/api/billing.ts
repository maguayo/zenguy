import { apiGet, apiPost } from "../lib/api";
import type { Billing, BillingConfig, PaddleCheckoutIntent } from "./types";

export function getBillingConfig(): Promise<BillingConfig> {
  return apiGet("/api/billing/config");
}

export function getBilling(workspaceId: string): Promise<Billing> {
  return apiGet(`/api/workspaces/${encodeURIComponent(workspaceId)}/billing`);
}

export function startSubscriptionCheckout(
  workspaceId: string,
): Promise<PaddleCheckoutIntent> {
  return apiPost(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/billing/checkout`,
    {},
  );
}

export async function getInvoiceUrl(
  workspaceId: string,
  transactionId: string,
): Promise<string> {
  const result = await apiGet<{ url: string }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/billing/invoices/${encodeURIComponent(transactionId)}/url`,
  );
  return result.url;
}
