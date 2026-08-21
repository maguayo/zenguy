import { apiGet, apiGetPage, apiPatch, apiPost, type ApiPage } from "../lib/api";
import type {
  AlertQuote,
  AlertSettings,
  AlertsOverview,
  CreditEntry,
  CreditTopUpCheckout,
} from "./types";

export interface UpdateAlertSettingsInput {
  dailyPaidAlertLimit?: number;
  paidChannelsEnabled?: boolean;
}

export function alertsQueryKey(workspaceId: string) {
  return ["ws", workspaceId, "alerts"] as const;
}

export function alertsPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/alerts`;
}

export function creditEntriesPath(
  workspaceId: string,
  options: { cursor?: string | null; limit?: number } = {},
): string {
  const search = new URLSearchParams({ limit: String(options.limit ?? 25) });
  if (options.cursor) search.set("cursor", options.cursor);
  return `${alertsPath(workspaceId)}/credit/entries?${search}`;
}

export function quotePath(workspaceId: string, phoneNumber: string): string {
  return `${alertsPath(workspaceId)}/quote?${new URLSearchParams({ phoneNumber })}`;
}

export function getAlertsOverview(workspaceId: string): Promise<AlertsOverview> {
  return apiGet(alertsPath(workspaceId));
}

export function updateAlertSettings(
  workspaceId: string,
  input: UpdateAlertSettingsInput,
): Promise<AlertSettings> {
  return apiPatch(`${alertsPath(workspaceId)}/settings`, input);
}

export function quoteAlertPrice(
  workspaceId: string,
  phoneNumber: string,
): Promise<AlertQuote> {
  return apiGet(quotePath(workspaceId, phoneNumber));
}

export function listCreditEntries(
  workspaceId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ApiPage<CreditEntry>> {
  return apiGetPage(creditEntriesPath(workspaceId, options));
}

export function startCreditTopUp(
  workspaceId: string,
  packs: number,
): Promise<CreditTopUpCheckout> {
  return apiPost(`${alertsPath(workspaceId)}/credit/topups`, { packs });
}
