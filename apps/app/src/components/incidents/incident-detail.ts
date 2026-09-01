import type { Incident, IncidentDelivery, IncidentDetail } from "@/api/types";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { Tone } from "@/theme";

export const emptyDeliveriesCopy =
  "No notifications were configured when this incident opened.";

export function incidentResourceLabel(resourceType: Incident["resourceType"]): string {
  return resourceType === "BROWSER_TEST" ? "browser test" : "monitor";
}

export function incidentResourceHref(
  workspaceId: string,
  incident: Pick<Incident, "resourceId" | "resourceType">,
): string {
  return incident.resourceType === "BROWSER_TEST"
    ? `/w/${workspaceId}/tests/${incident.resourceId}`
    : `/w/${workspaceId}/uptime/${incident.resourceId}`;
}

export interface EvidenceLink {
  href: string;
  label: string;
}

/** The failing run or check that opened the incident, when the API still knows it. */
export function openedByLink(
  workspaceId: string,
  incident: Pick<IncidentDetail, "openedByCheckId" | "openedByRunId" | "resourceId">,
): EvidenceLink | null {
  if (incident.openedByRunId) {
    return { href: `/w/${workspaceId}/runs/${incident.openedByRunId}`, label: `Run ${incident.openedByRunId}` };
  }
  if (incident.openedByCheckId) {
    return {
      href: `/w/${workspaceId}/uptime/${incident.resourceId}?check=${encodeURIComponent(incident.openedByCheckId)}`,
      label: `Check ${incident.openedByCheckId}`,
    };
  }
  return null;
}

/** "Opened … · 2m 00s · Resolved …" like the web page header. */
export function incidentMeta(
  incident: Pick<Incident, "openedAt" | "resolvedAt">,
  durationMs: number,
  timezone: string,
): string {
  return [
    `Opened ${formatDateTime(incident.openedAt, timezone)}`,
    formatDuration(durationMs),
    ...(incident.resolvedAt ? [`Resolved ${formatDateTime(incident.resolvedAt, timezone)}`] : []),
  ].join(" · ");
}

export function incidentDeliveryEvent(eventType: IncidentDelivery["eventType"]): string {
  return eventType === "FAILURE" ? "Failure" : "Recovery";
}

export function incidentDeliveryStatus(
  status: IncidentDelivery["status"],
): { label: string; tone: Tone } {
  if (status === "SENT") return { label: "Sent", tone: "ok" };
  if (status === "FAILED") return { label: "Failed", tone: "danger" };
  if (status === "AMBIGUOUS") {
    return { label: "Needs reconciliation", tone: "warn" };
  }
  return { label: "Pending", tone: "neutral" };
}

export function incidentDeliveryTime(
  delivery: Pick<IncidentDelivery, "createdAt" | "sentAt">,
  timezone: string,
): string {
  return formatDateTime(delivery.sentAt ?? delivery.createdAt, timezone);
}
