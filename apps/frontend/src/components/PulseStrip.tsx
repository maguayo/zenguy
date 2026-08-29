import clsx from "clsx";
import { Link } from "react-router-dom";

import type { CheckTick, RunStatus, RunTick } from "../api/types";
import { formatRelative } from "../lib/format";

export interface PulseStripProps {
  className?: string;
  /** Number of slots; missing history renders as quiet placeholders. */
  max?: number;
  /** Oldest first; the last tick is the most recent run. */
  runs: RunTick[];
  workspaceId: string;
}

export interface CheckPulseStripProps {
  /** Oldest first; the last tick is the most recent check. */
  checks: CheckTick[];
  className?: string;
  /** Number of slots; missing history renders as quiet placeholders. */
  max?: number;
}

export interface RunHistoryStripProps {
  className?: string;
  /** Number of slots; missing history renders as quiet placeholders. */
  max?: number;
  /** Oldest first; timestamps are run creation times from the runs endpoint. */
  runs: Array<Pick<RunTick, "id" | "status"> & { createdAt: string }>;
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

function checkTickLabel(tick: CheckTick): string {
  return `${tickTone[tick.status].label} · ${formatRelative(tick.checkedAt)}`;
}

function runHistoryTickLabel(tick: RunHistoryStripProps["runs"][number]): string {
  return `${tickTone[tick.status].label} · ${formatRelative(tick.createdAt)}`;
}

const COMPLETED: ReadonlySet<RunStatus> = new Set(["FAILED", "PASSED", "TIMEOUT"]);

/** "17/20 passed" over completed results; null while there is nothing to count. */
export function passRateLabel<T extends { status: RunStatus }>(ticks: readonly T[]): string | null {
  const completed = ticks.filter((tick) => COMPLETED.has(tick.status));
  if (completed.length === 0) return null;
  const passed = completed.filter((tick) => tick.status === "PASSED").length;
  return `${passed}/${completed.length} passed`;
}

interface VisualTick {
  className: string;
  href?: string;
  id: string;
  label: string;
}

interface VisualPulseStripProps {
  className?: string;
  max: number;
  ticks: VisualTick[];
}

const tickShape = "h-6 min-w-[4px] flex-1 rounded-[4px]";

/** Shared visual track for browser runs and uptime checks. */
function VisualPulseStrip({ className, max, ticks }: VisualPulseStripProps) {
  const recent = ticks.slice(-max);
  const placeholders = Math.max(0, max - recent.length);

  return (
    <div className={clsx("flex w-full cursor-default items-center gap-[3px]", className)}>
      {Array.from({ length: placeholders }, (_, index) => (
        <span
          key={`empty-${index}`}
          aria-hidden="true"
          className={clsx(tickShape, "bg-zinc-200/70")}
        />
      ))}
      {recent.map((tick) =>
        tick.href ? (
          <Link
            key={tick.id}
            aria-label={tick.label}
            className={clsx(
              tickShape,
              "cursor-pointer transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2",
              tick.className,
            )}
            title={tick.label}
            to={tick.href}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            key={tick.id}
            aria-label={tick.label}
            className={clsx(tickShape, tick.className)}
            role="img"
            title={tick.label}
          />
        ),
      )}
    </div>
  );
}

/**
 * The product signature, shared with the iOS list: one tick per recent run,
 * coloured by result, newest on the right, breathing while work is in
 * progress. Each tick opens its run.
 */
export function PulseStrip({ className, max = 20, runs, workspaceId }: PulseStripProps) {
  return (
    <VisualPulseStrip
      className={className}
      max={max}
      ticks={runs.map((run) => ({
        className: tickTone[run.status].className,
        id: run.id,
        label: tickLabel(run),
        href: `/w/${workspaceId}/runs/${run.id}`,
      }))}
    />
  );
}

/** Uptime history uses the same visual language without linking each check. */
export function CheckPulseStrip({ checks, className, max = 20 }: CheckPulseStripProps) {
  return (
    <VisualPulseStrip
      className={className}
      max={max}
      ticks={checks.map((check) => ({
        className: tickTone[check.status].className,
        id: check.id,
        label: checkTickLabel(check),
      }))}
    />
  );
}

/** Detail-page history sourced from run-list items, which expose creation time rather than finish time. */
export function RunHistoryStrip({
  className,
  max = 20,
  runs,
  workspaceId,
}: RunHistoryStripProps) {
  return (
    <VisualPulseStrip
      className={className}
      max={max}
      ticks={runs.map((run) => ({
        className: tickTone[run.status].className,
        id: run.id,
        label: runHistoryTickLabel(run),
        href: `/w/${workspaceId}/runs/${run.id}`,
      }))}
    />
  );
}
