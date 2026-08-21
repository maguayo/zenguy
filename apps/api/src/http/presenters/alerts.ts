import type { AlertsOverview } from "../../application/alerts/get_alerts_overview";
import type { CreditEntryOutput } from "../../application/alerts/list_credit_entries";
import type { AlertSettings } from "../../domain/alerts/types";

export function presentAlertsOverview(overview: AlertsOverview) {
  return overview;
}

export function presentAlertSettings(settings: AlertSettings) {
  return {
    paidChannelsEnabled: settings.paidChannelsEnabled,
    dailyPaidAlertLimit: settings.dailyPaidAlertLimit,
    updatedAt: new Date(settings.updatedAt).toISOString(),
  };
}

export function presentCreditEntry(entry: CreditEntryOutput) {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt).toISOString(),
  };
}
