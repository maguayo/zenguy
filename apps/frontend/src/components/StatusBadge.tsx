import { Wrench } from "lucide-react";
import clsx from "clsx";

import { Badge, type BadgeProps } from "./ui/Badge";
import { Tooltip } from "./ui/Tooltip";

const statusMap: Record<
  string,
  { label: string; pulse?: boolean; tone: NonNullable<BadgeProps["tone"]> }
> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  STARTING: { label: "Starting", pulse: true, tone: "info" },
  RUNNING: { label: "Running", pulse: true, tone: "info" },
  CHECKING: { label: "Checking", pulse: true, tone: "info" },
  PASSED: { label: "Passed", tone: "ok" },
  UP: { label: "Up", tone: "ok" },
  RESOLVED: { label: "Resolved", tone: "ok" },
  SENT: { label: "Sent", tone: "ok" },
  FAILED: { label: "Failed", tone: "danger" },
  DOWN: { label: "Down", tone: "danger" },
  OPEN: { label: "Open", pulse: true, tone: "danger" },
  TIMEOUT: { label: "Timeout", tone: "warn" },
  SYSTEM_ERROR: { label: "System error", tone: "neutral" },
  UNKNOWN: { label: "Unknown", tone: "neutral" },
  PENDING: { label: "Pending", tone: "neutral" },
  AMBIGUOUS: { label: "Needs reconciliation", tone: "warn" },
};

function fallbackLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface StatusBadgeProps {
  passedAfterRetry?: boolean;
  status: string;
}

export function StatusBadge({ passedAfterRetry = false, status }: StatusBadgeProps) {
  const config = statusMap[status] ?? { label: fallbackLabel(status), tone: "neutral" as const };
  const badge = (
    <Badge tone={config.tone}>
      {status === "SYSTEM_ERROR" ? (
        <Wrench aria-hidden="true" className="size-3" />
      ) : (
        <span
          aria-hidden="true"
          className={clsx(
            "size-1.5 rounded-full bg-current",
            config.pulse && "motion-safe:animate-pulse",
          )}
        />
      )}
      {config.label}
    </Badge>
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status === "SYSTEM_ERROR" ? (
        <Tooltip content="An error on Zenguy's side — not billed, no incident.">{badge}</Tooltip>
      ) : (
        badge
      )}
      {passedAfterRetry ? (
        <Tooltip content="The first attempt failed, but a fresh clean browser completed the test successfully.">
          <Badge className="border border-warn-600/30" tone="warn">
            Passed after retry
          </Badge>
        </Tooltip>
      ) : null}
    </span>
  );
}
