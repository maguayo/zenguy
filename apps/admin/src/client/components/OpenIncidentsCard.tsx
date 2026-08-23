import type { OpenIncidentRow } from "../../shared/types";
import { formatDateTime, relativeSeconds } from "../lib/format";
import { Card } from "./Card";

const RESOURCE_LABEL: Record<OpenIncidentRow["resourceType"], string> = {
  BROWSER_TEST: "Browser test",
  UPTIME_MONITOR: "Monitor",
};

/** Everything still failing, oldest wound first — the list to work through. */
export function OpenIncidentsCard({
  incidents,
  now,
}: {
  incidents: OpenIncidentRow[];
  now: number;
}) {
  return (
    <Card
      aside={incidents.length === 0 ? undefined : `${incidents.length} open`}
      title="Open now"
    >
      {incidents.length === 0 ? (
        <p className="text-zinc-500">Nothing is open right now</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {incidents.map((incident) => (
            <li className="py-2.5 first:pt-0" key={incident.incidentId}>
              <p className="font-medium text-zinc-900">
                {incident.resourceName ?? "Unnamed resource"}
              </p>
              <p className="text-xs text-zinc-500">
                {RESOURCE_LABEL[incident.resourceType]}
                {" · "}
                {incident.workspaceName ?? "Unknown workspace"}
                {" · "}
                <span title={formatDateTime(incident.openedAt)}>
                  {`opened ${relativeSeconds(incident.openedAt, now)}`}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
