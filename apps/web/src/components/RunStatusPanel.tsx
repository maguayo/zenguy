import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { getRun } from "../api/tests";
import type { RunStatus } from "../api/types";
import { formatDuration } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { Card } from "./ui/Card";
import { ErrorState } from "./ui/ErrorState";
import { Skeleton } from "./ui/Skeleton";

export function isTerminalRun(status: RunStatus): boolean {
  return !["QUEUED", "RUNNING"].includes(status);
}

export interface RunStatusPanelProps {
  compact?: boolean;
  onTerminal?: () => void;
  runId: string;
  wsId: string;
}

export function RunStatusPanel({
  compact = false,
  onTerminal,
  runId,
  wsId,
}: RunStatusPanelProps) {
  const run = useQuery({
    queryFn: () => getRun(wsId, runId),
    queryKey: ["ws", wsId, "runs", runId],
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !isTerminalRun(status) ? 2_000 : false;
    },
  });

  useEffect(() => {
    if (run.data && isTerminalRun(run.data.status)) onTerminal?.();
  }, [onTerminal, run.data]);

  if (run.isPending) {
    return (
      <div aria-label="Loading validation run" className="space-y-3" role="status">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (run.isError) return <ErrorState onRetry={() => void run.refetch()} />;

  const latestAttempt = run.data.attempts.at(-1);
  const latestStep = latestAttempt?.latestStep;
  const latestScreenshot = latestAttempt?.latestScreenshot;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge
          passedAfterRetry={run.data.passedAfterRetry}
          status={run.data.status}
        />
        <span className="text-xs text-zinc-500">
          {formatDuration(run.data.durationMs)} · {run.data.attemptCount} attempt
          {run.data.attemptCount === 1 ? "" : "s"}
        </span>
      </div>
      {latestStep ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {latestStep.description}
        </p>
      ) : !isTerminalRun(run.data.status) ? (
        <p className="text-sm text-zinc-500">Waiting for the browser to start…</p>
      ) : null}
      {latestScreenshot ? (
        <img
          alt="Latest validation screenshot"
          className={compact ? "max-h-48 w-full rounded-md object-cover object-top" : "w-full rounded-md"}
          loading="lazy"
          src={latestScreenshot.url}
        />
      ) : null}
      {isTerminalRun(run.data.status) && latestAttempt?.failureReason ? (
        <Card className="border-danger-600/20 bg-danger-50" padding="sm">
          <p className="text-sm text-danger-700">{latestAttempt.failureReason}</p>
        </Card>
      ) : null}
    </div>
  );
}
