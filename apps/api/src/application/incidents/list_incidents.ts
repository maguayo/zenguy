import type { IncidentRepo } from "../../domain/incidents/repo";
import type {
  IncidentFilters,
  IncidentWithResourceName,
} from "../../domain/incidents/types";
import type { Clock } from "../../shared/clock";
import { validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";
import type { IncidentListItemOutput } from "./incident_models";

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

export type IncidentStatusFilter = "open" | "resolved";
export type IncidentTypeFilter = "browser" | "uptime";

export interface IncidentPage {
  incidents: IncidentListItemOutput[];
  nextCursor: string | null;
}

function parseIsoBoundary(
  value: string,
  field: "from" | "to",
): number {
  const dateOnly = DATE_ONLY.test(value);
  if (!dateOnly && !ISO_DATE_TIME.test(value)) {
    throw validation([{ field, message: "Must be an ISO date or timestamp" }]);
  }
  const timestamp = Date.parse(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (
    !Number.isFinite(timestamp) ||
    (dateOnly && new Date(timestamp).toISOString().slice(0, 10) !== value)
  ) {
    throw validation([{ field, message: "Must be an ISO date or timestamp" }]);
  }
  return field === "to" && dateOnly ? timestamp + DAY_MS - 1 : timestamp;
}

function toOutput(
  incident: IncidentWithResourceName,
  now: number,
): IncidentListItemOutput {
  const end = incident.resolvedAt ?? now;
  return {
    id: incident.id,
    resourceType: incident.resourceType,
    resourceId:
      incident.resourceType === "BROWSER_TEST"
        ? (incident.browserTestId as string)
        : (incident.uptimeMonitorId as string),
    resourceName: incident.resourceName,
    status: incident.status,
    openedAt: incident.openedAt,
    resolvedAt: incident.resolvedAt,
    durationMs: Math.max(0, end - incident.openedAt),
    lastEventAt: incident.lastEventAt,
  };
}

export class ListIncidents {
  constructor(
    private readonly incidents: IncidentRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    status?: IncidentStatusFilter;
    type?: IncidentTypeFilter;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }): Promise<IncidentPage> {
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw validation([
        { field: "limit", message: "Must be an integer between 1 and 100" },
      ]);
    }
    const fromMs =
      input.from === undefined
        ? undefined
        : parseIsoBoundary(input.from, "from");
    const toMs =
      input.to === undefined ? undefined : parseIsoBoundary(input.to, "to");
    if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
      throw validation([
        { field: "to", message: "Must be on or after from" },
      ]);
    }
    const filters: IncidentFilters = {
      ...(input.status === undefined
        ? {}
        : { status: input.status === "open" ? "OPEN" : "RESOLVED" }),
      ...(input.type === undefined
        ? {}
        : {
            resourceType:
              input.type === "browser" ? "BROWSER_TEST" : "UPTIME_MONITOR",
          }),
      ...(fromMs === undefined ? {} : { fromMs }),
      ...(toMs === undefined ? {} : { toMs }),
    };
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.incidents.list(
      input.workspaceId,
      filters,
      cursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const now = this.clock.now();
    return {
      incidents: page.map((incident) => toOutput(incident, now)),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.openedAt, last.id)
          : null,
    };
  }
}

export { toOutput as incidentListItemOutput };
