import {
  AlertTriangle,
  CheckCircle2,
  Send,
  Siren,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { IncidentEvent, IncidentDetail } from "../api/types";
import { formatDateTime } from "../lib/format";
import { Badge } from "./ui/Badge";

type TimelineTone = "danger" | "warn" | "info" | "ok" | "neutral";

const eventConfig: Record<IncidentEvent["type"], { icon: LucideIcon; tone: TimelineTone }> = {
  FAILURE_RECORDED: { icon: XCircle, tone: "danger" },
  MONITOR_DELETED: { icon: Trash2, tone: "neutral" },
  NOTIFICATION_FAILED: { icon: AlertTriangle, tone: "warn" },
  NOTIFICATION_SENT: { icon: Send, tone: "info" },
  OPENED: { icon: Siren, tone: "danger" },
  RESOLVED: { icon: CheckCircle2, tone: "ok" },
  TEST_DELETED: { icon: Trash2, tone: "neutral" },
};

const toneClasses: Record<TimelineTone, string> = {
  danger: "bg-danger-50 text-danger-700",
  info: "bg-info-50 text-info-600",
  neutral: "bg-zinc-100 text-zinc-600",
  ok: "bg-ok-50 text-ok-700",
  warn: "bg-warn-50 text-warn-600",
};

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function sortedIncidentEvents(events: IncidentEvent[]): IncidentEvent[] {
  return [...events].sort((left, right) => {
    const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return difference || left.id.localeCompare(right.id);
  });
}

export function eventEvidenceIds(event: IncidentEvent): { checkId: string | null; runId: string | null } {
  const runFromMessage = /\bRun\s+([A-Za-z0-9_-]+)/u.exec(event.message)?.[1] ?? null;
  const checkFromMessage = /\bCheck\s+([A-Za-z0-9_-]+)/u.exec(event.message)?.[1] ?? null;
  return {
    checkId: metadataString(event.metadata, "checkId") ?? checkFromMessage,
    runId: metadataString(event.metadata, "runId") ?? runFromMessage,
  };
}

export function IncidentTimeline({
  events,
  incident,
  timezone,
  workspaceId,
}: {
  events: IncidentEvent[];
  incident: Pick<IncidentDetail, "resourceId" | "resourceType">;
  timezone: string;
  workspaceId: string;
}) {
  if (events.length === 0) return <p className="text-sm text-zinc-500">No events recorded.</p>;

  const ordered = sortedIncidentEvents(events);
  return (
    <ol>
      {ordered.map((event, index) => {
        const config = eventConfig[event.type];
        const Icon = config.icon;
        const channelName = metadataString(event.metadata, "channelName");
        const deliveryStatus = metadataString(event.metadata, "status");
        const { checkId, runId } = eventEvidenceIds(event);
        return (
          <li className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0" key={event.id}>
            {index < ordered.length - 1 ? (
              <span aria-hidden="true" className="absolute bottom-0 left-[1.09375rem] top-9 w-px bg-zinc-200" />
            ) : null}
            <span className={`relative z-10 grid size-9 place-items-center rounded-full ${toneClasses[config.tone]}`}>
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-zinc-900">{event.message}</p>
                <time className="text-xs text-zinc-500" dateTime={event.createdAt}>
                  {formatDateTime(event.createdAt, timezone)}
                </time>
              </div>
              {channelName || deliveryStatus || runId || checkId ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {channelName ? <Badge>{channelName}</Badge> : null}
                  {deliveryStatus ? (
                    <Badge tone={deliveryStatus === "SENT" ? "ok" : deliveryStatus === "FAILED" ? "danger" : "neutral"}>
                      {deliveryStatus.toLowerCase().replace(/^./u, (letter) => letter.toUpperCase())}
                    </Badge>
                  ) : null}
                  {runId ? (
                    <Link className="rounded-full bg-accent-50 px-2 py-0.5 font-mono text-xs font-medium text-accent-700 hover:underline" to={`/w/${workspaceId}/runs/${runId}`}>
                      Run {runId}
                    </Link>
                  ) : null}
                  {checkId ? (
                    <Link
                      className="rounded-full bg-accent-50 px-2 py-0.5 font-mono text-xs font-medium text-accent-700 hover:underline"
                      to={`/w/${workspaceId}/uptime/${incident.resourceId}?check=${encodeURIComponent(checkId)}`}
                    >
                      Check {checkId}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
