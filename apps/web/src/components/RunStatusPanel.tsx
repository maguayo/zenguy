import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getAttempt, getRun } from "../api/tests";
import type { AttemptStatus, Run, RunStatus } from "../api/types";
import { itemQueryErrorMessage } from "../lib/errors";
import { formatDuration } from "../lib/format";
import { subscribeRun } from "../lib/sse";
import { StatusBadge } from "./StatusBadge";
import { Card } from "./ui/Card";
import { ErrorState } from "./ui/ErrorState";
import { Skeleton } from "./ui/Skeleton";

export function isTerminalRun(status: RunStatus): boolean {
  return !["QUEUED", "RUNNING"].includes(status);
}

export function attemptSymbol(status: AttemptStatus): string {
  if (status === "PASSED") return "✓";
  if (status === "FAILED") return "✗";
  if (status === "TIMEOUT") return "⏱";
  if (status === "SYSTEM_ERROR") return "⚙";
  return "…";
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
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["ws", wsId, "runs", runId] as const, [runId, wsId]);
  const [sseFailed, setSseFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const run = useQuery({
    queryFn: () => getRun(wsId, runId),
    queryKey,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const hasLiveStream = Boolean(query.state.data?.live?.url) && !sseFailed;
      return status && !isTerminalRun(status) && !hasLiveStream ? 2_000 : false;
    },
  });
  const latestAttempt = run.data?.attempts.at(-1);
  const needsAttemptDetail =
    Boolean(latestAttempt) &&
    Boolean(run.data && ["FAILED", "TIMEOUT"].includes(run.data.status));
  const attemptDetail = useQuery({
    enabled: needsAttemptDetail,
    queryFn: () => getAttempt(wsId, latestAttempt?.id ?? ""),
    queryKey: ["ws", wsId, "attempts", latestAttempt?.id],
  });
  const liveUrl = run.data?.live?.url;
  const runStatus = run.data?.status;

  useEffect(() => setSseFailed(false), [runId]);

  useEffect(() => {
    if (!runStatus || isTerminalRun(runStatus) || !liveUrl || sseFailed) return undefined;
    return subscribeRun(
      liveUrl,
      (update: Run) => queryClient.setQueryData(queryKey, update),
      {
        onDone: () => void run.refetch(),
        onError: () => {
          setSseFailed(true);
          void run.refetch();
        },
      },
    );
  }, [liveUrl, queryClient, queryKey, run.refetch, runStatus, sseFailed]);

  useEffect(() => {
    if (!run.data || isTerminalRun(run.data.status) || !run.data.startedAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run.data]);

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
  if (run.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(run.error)}
        onRetry={() => void run.refetch()}
      />
    );
  }

  const latestStep = latestAttempt?.latestStep;
  const latestScreenshot = latestAttempt?.latestScreenshot;
  const active = !isTerminalRun(run.data.status);
  const elapsed = run.data.startedAt
    ? formatDuration(active ? Math.max(0, now - new Date(run.data.startedAt).getTime()) : run.data.durationMs)
    : "—";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge
            passedAfterRetry={run.data.passedAfterRetry}
            status={run.data.status}
          />
          {active ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <span aria-hidden="true" className="motion-safe:animate-pulse size-2 rounded-full bg-info-600" />
              Live
            </span>
          ) : null}
        </div>
        <span className="text-xs text-zinc-500">
          {elapsed} · {run.data.attemptCount} attempt
          {run.data.attemptCount === 1 ? "" : "s"}
        </span>
      </div>
      {!compact && run.data.attempts.length > 0 ? (
        <ol className="flex gap-2 overflow-x-auto pb-1">
          {run.data.attempts.map((attempt) => (
            <li
              key={attempt.id}
              className="min-w-32 rounded-md border border-zinc-200 bg-white px-3 py-2"
            >
              <p className="text-xs font-medium text-zinc-900">
                Attempt {attempt.attemptIndex + 1} {attemptSymbol(attempt.status)}
              </p>
              {attempt.retryDelaySeconds > 0 ? (
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  waited {attempt.retryDelaySeconds} s
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
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
      {run.data.status === "PASSED" ? (
        <Card className="border-ok-600/20 bg-ok-50" padding="sm">
          <p className="text-sm font-semibold text-ok-700">Passed</p>
        </Card>
      ) : null}
      {run.data.status === "FAILED" || run.data.status === "TIMEOUT" ? (
        <Card className="border-danger-600/20 bg-danger-50" padding="sm">
          <p className="text-sm font-semibold text-danger-700">
            {latestAttempt?.failureReason ??
              (run.data.status === "TIMEOUT" ? "The attempt timed out." : "The test failed.")}
          </p>
          {needsAttemptDetail && attemptDetail.isPending ? (
            <div aria-label="Loading failure details" className="mt-3 space-y-2" role="status">
              <Skeleton className="h-14" />
            </div>
          ) : needsAttemptDetail && attemptDetail.isError ? (
            <ErrorState
              className="mt-3"
              message={itemQueryErrorMessage(attemptDetail.error)}
              onRetry={() => void attemptDetail.refetch()}
            />
          ) : attemptDetail.data?.expectedResult || attemptDetail.data?.actualResult ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-danger-600/20 bg-white/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Expected</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                  {attemptDetail.data.expectedResult ?? "—"}
                </p>
              </div>
              <div className="rounded-md border border-danger-600/20 bg-white/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Observed</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                  {attemptDetail.data.actualResult ?? "—"}
                </p>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
      {run.data.status === "SYSTEM_ERROR" ? (
        <Card className="border-zinc-300 bg-zinc-50" padding="sm">
          <p className="text-sm font-medium text-zinc-700">
            System error on our side — this run is not billed and no incident was opened.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
