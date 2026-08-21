import type { AlertRepo } from "../../domain/alerts/repo";
import {
  defaultAlertSettings,
  type AlertSettings,
} from "../../domain/alerts/types";

/** Loads the workspace's alert settings, creating the default row once. */
export async function ensureAlertSettings(
  alerts: Pick<AlertRepo, "findSettings" | "insertSettings">,
  workspaceId: string,
  now: number,
): Promise<AlertSettings> {
  const existing = await alerts.findSettings(workspaceId);
  if (existing !== null) return existing;
  const created = defaultAlertSettings(workspaceId, now);
  await alerts.insertSettings(created);
  return (await alerts.findSettings(workspaceId)) ?? created;
}

export interface PaidChannelContext {
  enabled: boolean;
  balanceCents: number;
}

export async function loadPaidChannelContext(
  alerts: Pick<AlertRepo, "findSettings" | "getBalanceCents">,
  workspaceId: string,
): Promise<PaidChannelContext> {
  const [settings, balanceCents] = await Promise.all([
    alerts.findSettings(workspaceId),
    alerts.getBalanceCents(workspaceId),
  ]);
  return { enabled: settings?.paidChannelsEnabled ?? false, balanceCents };
}

export function formatEuroCents(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
