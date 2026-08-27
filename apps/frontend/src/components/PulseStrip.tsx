import clsx from "clsx";
import { Link } from "react-router-dom";

import type { RunStatus, RunTick } from "../api/types";
import { formatRelative } from "../lib/format";

export interface PulseStripProps {
  className?: string;
  /** Number of slots; missing history renders as quiet placeholders. */
  max?: number;
  /** Oldest first; the last tick is the most recent run. */
  runs: RunTick[];
  workspaceId: string;
}

const tickTone: Record<RunStatus, { className: string; label: string }> = {
  FAILED: { className: "bg-danger-600", label: "Failed" },
  PASSED: { className: "bg-ok-600", label: "Passed" },
  QUEUED: {
    className: "bg-info-600 motion-safe:animate-pulse",
    label: "Queued",
  },
  RUNNING: {
    className: "bg-info-600 motion-safe:animate-pulse",
    label: "Running",
  },
  SYSTEM_ERROR: { className: "bg-zinc-300", label: "System error" },
  TIMEOUT: { className: "bg-warn-600", label: "Timeout" },
};

function tickLabel(tick: RunTick): string {
  const { label } = tickTone[tick.status];
  return `${label} · ${tick.finishedAt === null ? "in progress" : formatRelative(tick.finishedAt)}`;
}

const COMPLETED: ReadonlySet<RunStatus> = new Set(["FAILED", "PASSED", "TIMEOUT"]);

/** "17/20 passed" over completed runs; null while there is nothing to count. */
export function passRateLabel(runs: RunTick[]): string | null {
  const completed = runs.filter((run) => COMPLETED.has(run.status));
  if (completed.length === 0) return null;
  const passed = completed.filter((run) => run.status === "PASSED").length;
  return `${passed}/${completed.length} passed`;
}

/**
 * The product signature, shared with the iOS list: one tick per recent run,
 * coloured by result, newest on the right, breathing while work is in
 * progress. Each tick opens its run.
 */
export function PulseStrip({ className, max = 20, runs, workspaceId }: PulseStripProps) {
  const recent = runs.slice(-max);
  const placeholders = Math.max(0, max - recent.length);
  const tickShape =
    "h-[18px] w-full min-w-[3px] max-w-[7px] flex-1 rounded-[3px]";
  return (
    <div className={clsx("flex items-center gap-[3px]", className)}>
      {Array.from({ length: placeholders }, (_, index) => (
        <span
          key={`empty-${index}`}
          aria-hidden="true"
          className={clsx(tickShape, "bg-zinc-200/70")}
        />
      ))}
      {recent.map((run) => (
        <Link
          key={run.id}
          aria-label={tickLabel(run)}
          className={clsx(tickShape, "transition-opacity hover:opacity-75", tickTone[run.status].className)}
          title={tickLabel(run)}
          to={`/w/${workspaceId}/runs/${run.id}`}
        />
      ))}
    </div>
  );
}
