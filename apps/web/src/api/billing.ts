import { apiGet } from "../lib/api";
import type { Billing, BillingConfig } from "./types";

export function getBillingConfig(): Promise<BillingConfig> {
  return apiGet("/api/billing/config");
}

export function getBilling(workspaceId: string): Promise<Billing> {
  return apiGet(`/api/workspaces/${encodeURIComponent(workspaceId)}/billing`);
}
