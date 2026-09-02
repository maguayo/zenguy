import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Clock3,
  Globe2,
  Laptop,
  ListChecks,
  MoreHorizontal,
  Play,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { listChannels } from "../../api/channels";
import { deleteTest, getTest, listRuns } from "../../api/tests";
import type { BrowserTest, RunListItem, RunStatus } from "../../api/types";
import { CopyButton } from "../../components/CopyButton";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { IconButton } from "../../components/ui/IconButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { RemoteAiConsentBanner } from "../../components/RemoteAiConsentBanner";
import { Spinner } from "../../components/ui/Spinner";
import { Table, type TableColumn } from "../../components/ui/Table";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import type { ApiPage } from "../../lib/api";
import { apiErrorMessage, itemQueryErrorMessage } from "../../lib/errors";
import {
  formatDateTime,
  formatDuration,
  formatInterval,
  formatRelative,
} from "../../lib/format";
import { isActiveRun, useRunNow } from "./hooks";

const filterStatuses = ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const;
type RunFilter = "ALL" | (typeof filterStatuses)[number];
const historyLimit = 20;
const runPageSize = 10;
const performanceStatuses: ReadonlySet<RunStatus> = new Set([
  "PASSED",
  "FAILED",
  "TIMEOUT",
]);

export function parseRunFilter(value: string | null): RunFilter {
  return filterStatuses.includes(value as (typeof filterStatuses)[number])
    ? (value as RunFilter)
    : "ALL";
}

/** The runs endpoint is newest-first; the visual timeline reads oldest-to-newest. */
export function recentRunHistory(
  runs: readonly RunListItem[],
  max = historyLimit,
): RunListItem[] {
  return runs.slice(0, max).reverse();
}

export interface RecentPerformanceSummary {
  averageDurationMs: number | null;
  maxDurationMs: number;
  passed: number;
  retryCount: number;
  retryPercentage: number;
  total: number;
}

export function recentPerformanceSummary(
  runs: readonly RunListItem[],
): RecentPerformanceSummary {
  const completed = runs.filter((run) => performanceStatuses.has(run.status));
  const durations = completed.flatMap((run) =>
    run.durationMs === null ? [] : [run.durationMs],
  );
  const retryCount = completed.filter((run) => run.attemptCount > 1).length;
  return {
    averageDurationMs:
      durations.length === 0
        ? null
        : Math.round(
            durations.reduce((total, duration) => total + duration, 0) /
              durations.length,
          ),
    maxDurationMs: durations.length === 0 ? 0 : Math.max(...durations),
    passed: completed.filter((run) => run.status === "PASSED").length,
    retryCount,
    retryPercentage:
      completed.length === 0 ? 0 : Math.round((retryCount / completed.length) * 100),
    total: completed.length,
  };
}

export function durationPercentage(
  durationMs: number | null,
  maxDurationMs: number,
): number {
  if (durationMs === null || maxDurationMs <= 0) return 0;
  return Math.min(100, Math.max(12, Math.round((durationMs / maxDurationMs) * 100)));
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function deviceDescription(device: BrowserTest["device"]): string {
  return device === "DESKTOP" ? "Desktop · 1440 × 900" : "Mobile · 390 × 844";
}

function retryLabel(maxRetries: number): string {
  return `${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}`;
}

function channelCountLabel(count: number): string {
  if (count === 0) return "No channels";
  return `${count} alert ${count === 1 ? "channel" : "channels"}`;
}

function runTone(run: Pick<RunListItem, "passedAfterRetry" | "status">): string {
  if (run.status === "PASSED" && run.passedAfterRetry) return "bg-warn-600";
  switch (run.status) {
    case "PASSED":
      return "bg-ok-600";
    case "FAILED":
      return "bg-danger-600";
    case "TIMEOUT":
      return "bg-warn-600";
    case "QUEUED":
    case "RUNNING":
      return "bg-info-600 motion-safe:animate-pulse";
    default:
      return "bg-zinc-300";
  }
}

export function performanceLegendItems(
  runs: readonly Pick<RunListItem, "passedAfterRetry" | "status">[],
): Array<{ className: string; label: string }> {
  const hasRetriedPass = runs.some(
    (run) => run.status === "PASSED" && run.passedAfterRetry,
  );
  const hasTimeout = runs.some((run) => run.status === "TIMEOUT");
  return [
    { className: "bg-ok-600", label: "Direct" },
    {
      className: "bg-warn-600",
      label:
        hasRetriedPass && hasTimeout
          ? "Retried / timeout"
          : hasTimeout
            ? "Timeout"
            : "Retried",
    },
    ...(runs.some((run) => run.status === "FAILED")
      ? [{ className: "bg-danger-600", label: "Failed" }]
      : []),
    ...(runs.some((run) => run.status === "SYSTEM_ERROR")
      ? [{ className: "bg-zinc-300", label: "System error" }]
      : []),
    ...(runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING")
      ? [{ className: "bg-info-600", label: "Active" }]
      : []),
  ];
}

function SummaryFact({
  detail,
  icon,
  label,
  value,
}: {
  detail?: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-medium text-zinc-900">{value}</dd>
        {detail ? <dd className="mt-0.5 truncate text-xs text-zinc-500">{detail}</dd> : null}
      </div>
    </div>
  );
}

function PerformanceChart({
  runs,
  summary,
  workspaceId,
}: {
  runs: RunListItem[];
  summary: RecentPerformanceSummary;
  workspaceId: string;
}) {
  const placeholders = Math.max(0, historyLimit - runs.length);
  const oldest = runs[0];
  const newest = runs.at(-1);
  const legendItems = performanceLegendItems(runs);
  const label =
    summary.total === 0
      ? "Recent performance: no completed runs"
      : `Recent performance: ${summary.passed} of ${summary.total} completed runs passed`;

  return (
    <div>
      <div
        aria-label={label}
        className="grid h-24 grid-cols-[repeat(20,minmax(0,1fr))] items-end gap-1 sm:h-28 sm:gap-1.5"
        role="group"
      >
        {Array.from({ length: placeholders }, (_, index) => (
          <span
            key={`empty-${index}`}
            aria-hidden="true"
            className="h-1/3 rounded-[3px] bg-zinc-100"
          />
        ))}
        {runs.map((run) => {
          const percentage = durationPercentage(run.durationMs, summary.maxDurationMs);
          return (
            <Link
              key={run.id}
              aria-label={`${run.status.toLowerCase().replaceAll("_", " ")}, ${formatDuration(run.durationMs)}, ${formatRelative(run.createdAt)}`}
              className={clsx(
                "min-h-4 rounded-[3px] transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2",
                runTone(run),
              )}
              style={{ height: `${percentage === 0 ? 18 : percentage}%` }}
              title={`${formatDuration(run.durationMs)} · ${formatRelative(run.createdAt)}`}
              to={`/w/${workspaceId}/runs/${run.id}`}
            />
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[11px] text-zinc-500">
        <span>{oldest ? formatRelative(oldest.createdAt) : "No runs yet"}</span>
        <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {legendItems.map((item, index) => (
            <span
              key={`${item.label}-${index}`}
              className={clsx("items-center gap-1.5", index > 1 ? "hidden sm:inline-flex" : "inline-flex")}
            >
              <span
                aria-hidden="true"
                className={clsx("size-2 rounded-sm", item.className)}
              />
              {item.label}
            </span>
          ))}
        </span>
        <span className="text-right">{newest ? formatRelative(newest.createdAt) : "—"}</span>
      </div>
    </div>
  );
}

function PerformanceStat({ label, tone, value }: { label: string; tone?: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={clsx("mt-1 text-sm font-semibold text-zinc-950", tone)}>{value}</dd>
    </div>
  );
}

const filterLabels: Record<RunFilter, string> = {
  ALL: "All",
  FAILED: "Failed",
  PASSED: "Passed",
  SYSTEM_ERROR: "System error",
  TIMEOUT: "Timeout",
};

function RunFilterPills({
  allCount,
  onChange,
  value,
}: {
  allCount: number;
  onChange: (next: RunFilter) => void;
  value: RunFilter;
}) {
  const items: RunFilter[] = ["ALL", ...filterStatuses];
  return (
    <div aria-label="Filter run history" className="flex max-w-full gap-1.5 overflow-x-auto" role="group">
      {items.map((item) => {
        const active = item === value;
        return (
          <button
            key={item}
            aria-pressed={active}
            className={clsx(
              "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
              active
                ? "border-accent-200 bg-accent-50 text-accent-700"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
            )}
            type="button"
            onClick={() => onChange(item)}
          >
            {filterLabels[item]}
            {item === "ALL" ? ` · ${allCount}` : ""}
          </button>
        );
      })}
    </div>
  );
}

function runSourceLabel(source: RunListItem["source"]): string {
  switch (source) {
    case "MANUAL":
      return "Manual";
    case "SCHEDULED":
      return "Scheduled";
    case "VALIDATION":
      return "Validation";
  }
}

export function runColumns(
  test: BrowserTest,
  timezone: string,
  workspaceId: string,
  maxDurationMs = 0,
): TableColumn<RunListItem>[] {
  return [
    {
      className: "min-w-48",
      header: "Run",
      key: "run",
      render: (run) => (
        <Link
          className="group -m-2.5 block rounded-md p-2.5 transition-colors hover:bg-zinc-50"
          to={`/w/${workspaceId}/runs/${run.id}`}
        >
          <span className="inline-flex items-center gap-0.5 font-medium text-zinc-900 group-hover:text-accent-700 group-hover:underline">
            <time dateTime={run.createdAt}>{formatRelative(run.createdAt)}</time>
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            <time className="whitespace-nowrap" dateTime={run.createdAt}>
              {formatDateTime(run.createdAt, timezone)}
            </time>
          </span>
        </Link>
      ),
    },
    {
      header: "Result",
      key: "result",
      render: (run) => (
        <StatusBadge passedAfterRetry={run.passedAfterRetry} status={run.status} />
      ),
    },
    {
      header: "Duration",
      key: "duration",
      render: (run) => {
        const percentage = durationPercentage(run.durationMs, maxDurationMs);
        return (
          <div className="flex min-w-36 items-center gap-3 tabular-nums">
            <span className="w-14 shrink-0 text-zinc-900">{formatDuration(run.durationMs)}</span>
            <span className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-zinc-100">
              <span
                aria-hidden="true"
                className={clsx("block h-full rounded-full", runTone(run))}
                style={{ width: `${percentage}%` }}
              />
            </span>
          </div>
        );
      },
    },
    {
      header: "Attempts",
      key: "attempts",
      render: (run) => (
        <span className={clsx(run.attemptCount > 1 && "font-medium text-warn-600")}>
          {run.attemptCount} of {test.maxRetries + 1}
        </span>
      ),
    },
    {
      header: "Origin",
      key: "origin",
      render: (run) => (
        <div className="whitespace-nowrap">
          <p className="text-zinc-900">{runSourceLabel(run.source)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {run.billable ? "1 billable run" : "Not billed"}
          </p>
        </div>
      ),
    },
    {
      className: "w-10",
      header: <span className="sr-only">Open run</span>,
      key: "open",
      render: (run) => (
        <Link
          aria-label={`Open run from ${formatRelative(run.createdAt)}`}
          className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          to={`/w/${workspaceId}/runs/${run.id}`}
        >
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      ),
    },
  ];
}

function MobileRunList({
  maxAttempts,
  rows,
  timezone,
  workspaceId,
}: {
  maxAttempts: number;
  rows: RunListItem[];
  timezone: string;
  workspaceId: string;
}) {
  return (
    <ul aria-label="Runs" className="divide-y divide-zinc-200">
      {rows.map((run) => (
        <li key={run.id} className="px-5 py-4">
          <Link
            className="group -mx-5 -mt-4 block px-5 pb-3 pt-4 transition-colors hover:bg-zinc-50"
            to={`/w/${workspaceId}/runs/${run.id}`}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <time
                    className="text-sm font-semibold text-zinc-950 group-hover:text-accent-700 group-hover:underline"
                    dateTime={run.createdAt}
                  >
                    {formatRelative(run.createdAt)}
                  </time>
                </div>
                <time className="mt-1 block text-xs text-zinc-500" dateTime={run.createdAt}>
                  {formatDateTime(run.createdAt, timezone)}
                </time>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="mt-1 size-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5"
              />
            </div>
          </Link>
          <div>
            <StatusBadge passedAfterRetry={run.passedAfterRetry} status={run.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-zinc-50/90 p-3 min-[520px]:grid-cols-4">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Duration
              </dt>
              <dd className="mt-0.5 text-xs font-medium text-zinc-800">
                {formatDuration(run.durationMs)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Attempts
              </dt>
              <dd className="mt-0.5 text-xs font-medium text-zinc-800">
                {run.attemptCount} of {maxAttempts}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Origin
              </dt>
              <dd className="mt-0.5 truncate text-xs font-medium text-zinc-800">
                {runSourceLabel(run.source)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Usage
              </dt>
              <dd className="mt-0.5 text-xs font-medium text-zinc-800">
                {run.billable ? "1 run" : "Not billed"}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export default function TestDetailPage() {
  const { testId = "" } = useParams();
  const { can, current, timezone } = useWorkspace();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [visibleAllRuns, setVisibleAllRuns] = useState(runPageSize);
  const filter = parseRunFilter(searchParams.get("status"));
  const status = filter === "ALL" ? null : (filter as RunStatus);
  const test = useQuery({
    queryFn: () => getTest(current.id, testId),
    queryKey: ["ws", current.id, "tests", testId],
  });
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const allRuns = useInfiniteQuery<ApiPage<RunListItem>>({
    enabled: test.isSuccess,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listRuns(current.id, testId, {
        cursor: pageParam as string | null,
        limit: historyLimit,
      }),
    queryKey: ["ws", current.id, "tests", testId, "runs", "all"],
  });
  const filteredRuns = useInfiniteQuery<ApiPage<RunListItem>>({
    enabled: test.isSuccess && status !== null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listRuns(current.id, testId, {
        cursor: pageParam as string | null,
        limit: runPageSize,
        status,
      }),
    queryKey: ["ws", current.id, "tests", testId, "runs", "filtered", { status }],
  });
  const runs = status === null ? allRuns : filteredRuns;
  const remove = useMutation({ mutationFn: () => deleteTest(current.id, testId) });
  const run = useRunNow(
    test.data ?? {
      channelIds: [],
      createdAt: "",
      createdBy: null,
      device: "DESKTOP",
      id: testId,
      instructions: "",
      intervalHours: 24,
      lastRun: null,
      maxRetries: 0,
      name: "Browser test",
      nextRunAt: "",
      notifyOnRecovery: false,
      openIncidentId: null,
      startUrl: "",
      updatedAt: "",
    },
  );

  useEffect(() => {
    setVisibleAllRuns(runPageSize);
  }, [testId]);

  const deleteCurrentTest = async () => {
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success("Test deleted");
      navigate(`/w/${current.id}/tests`, { replace: true });
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  if (test.isPending || channels.isPending) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Spinner label="Loading browser test" size={6} />
      </div>
    );
  }
  if (test.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(test.error)}
        onRetry={() => void test.refetch()}
      />
    );
  }
  if (channels.isError) return <ErrorState onRetry={() => void channels.refetch()} />;

  const testData = test.data;
  const channelNames = new Map((channels.data ?? []).map((channel) => [channel.id, channel.name]));
  const loadedRows = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const rows = status === null ? loadedRows.slice(0, visibleAllRuns) : loadedRows;
  const hasHiddenAllRuns = status === null && rows.length < loadedRows.length;
  const historyRows = allRuns.data?.pages.flatMap((page) => page.items) ?? [];
  const historyRuns = recentRunHistory(historyRows);
  const lastRun = testData.lastRun;
  const headlineRun = historyRows[0] ?? lastRun;
  const performance = recentPerformanceSummary(historyRuns);
  const latestPerformanceRun = lastRun;
  const maxRowDurationMs = Math.max(
    0,
    ...rows.flatMap((item) => (item.durationMs === null ? [] : [item.durationMs])),
  );
  const DeviceIcon = testData.device === "DESKTOP" ? Laptop : Smartphone;
  const instructionsCanExpand =
    testData.instructions.length > 360 || testData.instructions.split("\n").length > 6;
  const runNowDisabled = run.pending || isActiveRun(testData);
  const nextRunCursor = hasHiddenAllRuns
    ? "show-more-loaded-runs"
    : runs.hasNextPage
      ? runs.data?.pages.at(-1)?.nextCursor ?? null
      : null;
  const loadMoreRuns = async () => {
    if (hasHiddenAllRuns) {
      setVisibleAllRuns((count) => count + runPageSize);
      return;
    }
    await runs.fetchNextPage();
    if (status === null) setVisibleAllRuns((count) => count + runPageSize);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"
        >
          <Link className="shrink-0 hover:text-zinc-900 hover:underline" to={`/w/${current.id}/tests`}>
            Browser Tests
          </Link>
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
          <span aria-current="page" className="truncate text-zinc-700">
            {testData.name}
          </span>
        </nav>

        <PageHeader
          actions={
            <>
              {can("tests.run") ? (
                <Button disabled={runNowDisabled} variant="primary" onClick={run.requestRun}>
                  <Play aria-hidden="true" className="size-4" />
                  Run now
                </Button>
              ) : null}
              {can("tests.manage") ? (
                <>
                  <Link
                    className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    to={`/w/${current.id}/tests/${testData.id}/edit`}
                  >
                    Edit
                  </Link>
                  <Dropdown
                    items={[
                      {
                        label: "Delete",
                        onSelect: () => setDeleteOpen(true),
                        tone: "danger",
                      },
                    ]}
                    trigger={
                      <IconButton
                        aria-label={`More actions for ${testData.name}`}
                        className="border border-zinc-300 bg-white hover:bg-zinc-50"
                      >
                        <MoreHorizontal aria-hidden="true" className="size-4" />
                      </IconButton>
                    }
                  />
                </>
              ) : null}
            </>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Globe2 aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{hostLabel(testData.startUrl)}</span>
              </span>
              <span aria-hidden="true" className="text-zinc-300">·</span>
              <span className="inline-flex items-center gap-1.5">
                <DeviceIcon aria-hidden="true" className="size-3.5" />
                {testData.device === "DESKTOP" ? "Desktop" : "Mobile"}
              </span>
              <span aria-hidden="true" className="text-zinc-300">·</span>
              <span>Next run {formatRelative(testData.nextRunAt)}</span>
            </span>
          }
          title={
            <span className="inline-flex flex-wrap items-center gap-2.5">
              <span>{testData.name}</span>
              {headlineRun ? (
                <StatusBadge status={headlineRun.status} />
              ) : (
                <Badge tone="neutral">Never run</Badge>
              )}
            </span>
          }
        />
      </div>

      <RemoteAiConsentBanner />

      {testData.openIncidentId ? (
        <Card className="border-danger-600/20 bg-danger-50">
          <div className="flex flex-wrap items-center justify-between gap-3 text-danger-700">
            <p className="flex items-center gap-2 font-medium">
              <CircleAlert aria-hidden="true" className="size-4" />
              This test has an open incident.
            </p>
            <Link
              className="text-sm font-medium text-danger-700 hover:underline"
              to={`/w/${current.id}/incidents/${testData.openIncidentId}`}
            >
              View incident →
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden rounded-xl" padding="none">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-950">Recent performance</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Last {historyLimit} runs, duration of each
                </p>
              </div>
              {performance.total > 0 ? (
                <Badge tone={performance.passed === performance.total ? "ok" : "neutral"}>
                  {performance.passed}/{performance.total} passed
                </Badge>
              ) : (
                <Badge tone="neutral">No results</Badge>
              )}
            </div>

            {allRuns.isError ? (
              <div className="mt-6 flex min-h-28 items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
                <span>Performance history is temporarily unavailable.</span>
                <button
                  className="shrink-0 font-medium text-accent-700 hover:underline"
                  type="button"
                  onClick={() => void allRuns.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : allRuns.isPending ? (
              <div
                aria-label="Loading recent performance"
                className="mt-6 h-28 animate-pulse rounded-lg bg-zinc-100"
                role="status"
              />
            ) : (
              <div className="mt-6">
                <PerformanceChart
                  runs={historyRuns}
                  summary={performance}
                  workspaceId={current.id}
                />
              </div>
            )}

            <dl className="mt-5 grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-3">
              <PerformanceStat
                label="Latest run"
                value={
                  latestPerformanceRun
                    ? `${formatRelative(latestPerformanceRun.finishedAt ?? latestPerformanceRun.createdAt)} · ${formatDuration(latestPerformanceRun.durationMs)}`
                    : "No completed runs"
                }
              />
              <PerformanceStat
                label="Average duration"
                value={formatDuration(performance.averageDurationMs)}
              />
              <PerformanceStat
                label={`With retry (${performance.total} runs)`}
                tone={performance.retryCount > 0 ? "text-warn-600" : undefined}
                value={`${performance.retryCount} ${performance.retryCount === 1 ? "run" : "runs"} · ${performance.retryPercentage}%`}
              />
            </dl>
          </div>
        </Card>

        <Card className="rounded-xl" padding="none">
          <aside className="flex h-full flex-col p-5">
            <dl className="divide-y divide-zinc-200">
              <SummaryFact
                detail={
                  <time dateTime={testData.nextRunAt}>
                    {formatDateTime(testData.nextRunAt, timezone)}
                  </time>
                }
                icon={<CalendarClock aria-hidden="true" className="size-4" />}
                label="Next run"
                value={
                  <time dateTime={testData.nextRunAt}>
                    {formatRelative(testData.nextRunAt)}
                  </time>
                }
              />
              <SummaryFact
                icon={<Clock3 aria-hidden="true" className="size-4" />}
                label="Frequency"
                value={formatInterval(testData.intervalHours)}
              />
              <SummaryFact
                icon={<Bell aria-hidden="true" className="size-4" />}
                label="Alerts"
                value={channelCountLabel(testData.channelIds.length)}
              />
              <SummaryFact
                icon={<RotateCcw aria-hidden="true" className="size-4" />}
                label="Retry policy"
                value={retryLabel(testData.maxRetries)}
              />
            </dl>
            <a
              className="mt-auto border-t border-zinc-200 pt-3 text-xs font-medium text-accent-700 hover:underline"
              href="#test-setup"
            >
              View test setup →
            </a>
          </aside>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-xl" padding="none">
        <div className="px-5 pt-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Run history</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Open a run to inspect its attempts, evidence, and result.
              </p>
            </div>
            <RunFilterPills
              allCount={Math.min(historyRows.length, visibleAllRuns)}
              value={filter}
              onChange={(next) => {
                const params = new URLSearchParams(searchParams);
                if (next === "ALL") params.delete("status");
                else params.set("status", next);
                setSearchParams(params, { replace: true });
              }}
            />
          </div>
        </div>
        {runs.isError ? (
          <ErrorState className="m-4" onRetry={() => void runs.refetch()} />
        ) : (
          <>
            <div className="lg:hidden">
              {runs.isPending ? (
                <div className="grid min-h-40 place-items-center">
                  <Spinner label="Loading runs" />
                </div>
              ) : rows.length === 0 ? (
                <EmptyState
                  className="m-4"
                  description={
                    filter === "ALL"
                      ? "Run it now or wait for the schedule."
                      : "Try another status or return to all runs."
                  }
                  title={filter === "ALL" ? "No runs yet" : "No runs match this filter"}
                />
              ) : (
                <MobileRunList
                  maxAttempts={testData.maxRetries + 1}
                  rows={rows}
                  timezone={timezone}
                  workspaceId={current.id}
                />
              )}
            </div>
            <div className="hidden px-5 lg:block">
              <Table
                columns={runColumns(testData, timezone, current.id, maxRowDurationMs)}
                empty={
                  <EmptyState
                    className="m-4"
                    description={
                      filter === "ALL"
                        ? "Run it now or wait for the schedule."
                        : "Try another status or return to all runs."
                    }
                    title={filter === "ALL" ? "No runs yet" : "No runs match this filter"}
                  />
                }
                loading={runs.isPending}
                rowKey={(item) => item.id}
                rows={rows}
              />
            </div>
            <div className="flex min-h-12 items-center justify-between gap-4 border-t border-zinc-200 px-5 py-3">
              <p className="text-xs text-zinc-500">
                Showing {rows.length} {rows.length === 1 ? "run" : "runs"}
              </p>
              {nextRunCursor ? (
                <button
                  className="text-xs font-medium text-accent-700 hover:underline disabled:cursor-wait disabled:opacity-60"
                  disabled={runs.isFetchingNextPage}
                  type="button"
                  onClick={() => void loadMoreRuns()}
                >
                  {runs.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </Card>

      <section
        id="test-setup"
        aria-labelledby="test-setup-title"
        className="scroll-mt-20 space-y-3"
      >
        <div>
          <h2 id="test-setup-title" className="text-base font-semibold text-zinc-950">
            Test setup
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            The journey, browser environment, and alert delivery for this test.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
          <Card
            title={
              <span className="flex items-center gap-2">
                <ListChecks aria-hidden="true" className="size-4 text-zinc-500" />
                Journey instructions
              </span>
            }
          >
            <div className="rounded-lg bg-zinc-50/90 p-4 ring-1 ring-inset ring-zinc-200">
              <p
                id="test-instructions"
                className={`whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700 ${
                  instructionsExpanded ? "" : "line-clamp-6"
                }`}
              >
                {testData.instructions || "No instructions provided."}
              </p>
              {instructionsCanExpand ? (
                <button
                  aria-controls="test-instructions"
                  aria-expanded={instructionsExpanded}
                  className="mt-2 text-xs font-medium text-accent-700 hover:underline"
                  type="button"
                  onClick={() => setInstructionsExpanded((value) => !value)}
                >
                  {instructionsExpanded ? "Show less" : "Show more"}
                </button>
              ) : null}
            </div>
            <div className="mt-5 border-t border-zinc-200 pt-4">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                <Globe2 aria-hidden="true" className="size-3.5" />
                Starting URL
              </p>
              <div className="mt-2 flex min-w-0 items-center gap-1">
                <span className="truncate text-sm font-medium text-zinc-900" title={testData.startUrl}>
                  {testData.startUrl}
                </span>
                <CopyButton label="Copy starting URL" text={testData.startUrl} />
              </div>
            </div>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <Bell aria-hidden="true" className="size-4 text-zinc-500" />
                Environment & alerts
              </span>
            }
          >
            <dl className="divide-y divide-zinc-200">
              <div className="pb-4">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Browser
                </dt>
                <dd className="mt-1.5 flex items-center gap-2 text-sm font-medium text-zinc-900">
                  <DeviceIcon aria-hidden="true" className="size-4 text-zinc-400" />
                  {deviceDescription(testData.device)}
                </dd>
              </div>
              <div className="py-4">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Notification channels
                </dt>
                <dd className="mt-2 text-sm text-zinc-900">
                  {testData.channelIds.length === 0 ? (
                    "None"
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {testData.channelIds.map((channelId) => (
                        <Badge key={channelId}>
                          {channelNames.get(channelId) ?? "Unknown channel"}
                        </Badge>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
              <div className="pt-4">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Notify on recovery
                </dt>
                <dd className="mt-1.5 text-sm font-medium text-zinc-900">
                  {testData.notifyOnRecovery ? "Yes" : "No"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </section>

      <ConfirmDialog {...run.dialogProps} />
      <ConfirmDialog
        body="Its history stays available for 30 days."
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteCurrentTest}
        open={deleteOpen}
        title={`Delete "${testData.name}"?`}
        tone="danger"
      />
    </div>
  );
}
