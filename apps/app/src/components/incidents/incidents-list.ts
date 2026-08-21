import type { IncidentFilters } from "@/api/incidents";
import type { Incident } from "@/api/types";
import { firstParam } from "@/lib/links";
import type { Tone } from "@/theme";
import type { SegmentedTabItem, SelectOption } from "@/ui";

export type IncidentStatusTab = "open" | "resolved" | "all";
export type IncidentTypeFilter = "all" | "browser" | "uptime";

export const openIncidentsDescription =
  "Everything is passing. Incidents appear here when a test or monitor fails after all retries.";

export const incidentStatusTabs: SegmentedTabItem<IncidentStatusTab>[] = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

export const incidentTypeOptions: SelectOption<IncidentTypeFilter>[] = [
  { label: "All types", value: "all" },
  { label: "Browser tests", value: "browser" },
  { label: "Uptime monitors", value: "uptime" },
];

type ParamValue = string | string[] | null | undefined;

/** `status` search param (`?status=resolved`); anything unknown means the default "open" tab. */
export function parseIncidentStatus(value: ParamValue): IncidentStatusTab {
  const candidate = firstParam(value ?? undefined);
  return candidate === "resolved" || candidate === "all" ? candidate : "open";
}

/** `type` search param (`?type=browser`); anything unknown means every resource type. */
export function parseIncidentType(value: ParamValue): IncidentTypeFilter {
  const candidate = firstParam(value ?? undefined);
  return candidate === "browser" || candidate === "uptime" ? candidate : "all";
}

export function incidentFilters(
  status: IncidentStatusTab,
  type: IncidentTypeFilter,
): IncidentFilters {
  return {
    ...(status === "all" ? {} : { status }),
    ...(type === "all" ? {} : { type }),
  };
}

/** Open incidents keep counting from `openedAt`; resolved ones keep the API's final duration. */
export function liveIncidentDuration(incident: Incident, now: number): number {
  return incident.status === "OPEN"
    ? Math.max(0, now - new Date(incident.openedAt).getTime())
    : incident.durationMs;
}

export function hasOpenIncident(incidents: Incident[]): boolean {
  return incidents.some((incident) => incident.status === "OPEN");
}

export function resourceTypePresentation(
  resourceType: Incident["resourceType"],
): { label: string; tone: Tone } {
  return resourceType === "BROWSER_TEST"
    ? { label: "Browser test", tone: "info" }
    : { label: "Uptime monitor", tone: "accent" };
}
