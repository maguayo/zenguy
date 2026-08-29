import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Clock3,
  Globe2,
  History,
  Laptop,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { listChannels } from "../../api/channels";
import { deleteTest, getTest, listRuns } from "../../api/tests";
import type { BrowserTest, RunListItem, RunStatus } from "../../api/types";
import { CopyButton } from "../../components/CopyButton";
import { passRateLabel, RunHistoryStrip } from "../../components/PulseStrip";
import { RunSourceBadge } from "../../components/RunSourceBadge";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { IconButton } from "../../components/ui/IconButton";
import { LoadMore } from "../../components/ui/LoadMore";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Spinner";
import { Table, type TableColumn } from "../../components/ui/Table";
import { Tabs } from "../../components/ui/Tabs";
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

function historyIconTone(status: RunStatus | undefined): string {
  switch (status) {
    case "PASSED":
      return "bg-ok-50 text-ok-700";
    case "FAILED":
      return "bg-danger-50 text-danger-700";
    case "TIMEOUT":
      return "bg-warn-50 text-warn-600";
    case "QUEUED":
    case "RUNNING":
      return "bg-info-50 text-info-600";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

function SummaryFact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-zinc-500 ring-1 ring-inset ring-zinc-200">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-medium text-zinc-900">{value}</dd>
      </div>
    </div>
  );
}

export function runColumns(
  test: BrowserTest,
  timezone: string,
  workspaceId: string,
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
            <ChevronRight aria-hidden="true" className="size-3.5 text-zinc-400" />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
            <time className="whitespace-nowrap" dateTime={run.createdAt}>
              {formatDateTime(run.createdAt, timezone)}
            </time>
            <span aria-hidden="true">·</span>
            <RunSourceBadge source={run.source} />
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
      render: (run) => formatDuration(run.durationMs),
    },
    {
      header: "Attempts",
      key: "attempts",
      render: (run) => `${run.attemptCount} of ${test.maxRetries + 1}`,
    },
    {
      header: "Triggered by",
      key: "triggeredBy",
      render: (run) => (
        <div className="whitespace-nowrap">
          <p className="text-zinc-900">{run.triggeredBy?.name ?? "—"}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {run.billable ? "1 billable run" : "Not billed"}
          </p>
        </div>
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
                  <RunSourceBadge source={run.source} />
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
                Triggered by
              </dt>
              <dd className="mt-0.5 truncate text-xs font-medium text-zinc-800">
                {run.triggeredBy?.name ?? "—"}
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
  const DeviceIcon = testData.device === "DESKTOP" ? Laptop : Smartphone;
  const lastRunDetail = lastRun
    ? [
        lastRun.finishedAt
          ? formatRelative(lastRun.finishedAt)
          : lastRun.status === "QUEUED"
            ? "Queued"
            : "In progress",
        lastRun.durationMs === null ? null : formatDuration(lastRun.durationMs),
      ]
        .filter(Boolean)
        .join(" · ")
    : "Run it now or wait for the schedule.";
  const historyRate = passRateLabel(historyRuns);
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
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    to={`/w/${current.id}/tests/${testData.id}/edit`}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
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
                      <IconButton aria-label={`More actions for ${testData.name}`}>
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
            </span>
          }
          title={testData.name}
        />
      </div>

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

      <Card className="overflow-hidden" padding="none">
        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.75fr)]">
          <div className="min-w-0 p-5 sm:p-6 lg:border-r lg:border-zinc-200">
            <div className="flex flex-wrap items-start gap-4">
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-xl ${historyIconTone(lastRun?.status)}`}
              >
                <History aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Latest run
                </p>
                <div className="mt-2">
                  {lastRun ? (
                    <StatusBadge
                      passedAfterRetry={lastRun.passedAfterRetry}
                      status={lastRun.status}
                    />
                  ) : (
                    <Badge tone="neutral">Never run</Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-zinc-500">{lastRunDetail}</p>
              </div>
              {historyRate ? <Badge tone="accent">{historyRate}</Badge> : null}
            </div>

            <div className="mt-5 rounded-xl bg-zinc-50/90 p-4 ring-1 ring-inset ring-zinc-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">Recent performance</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Last {historyLimit} runs, oldest to newest
                  </p>
                </div>
                <span className="text-[11px] font-medium text-zinc-400">Newest →</span>
              </div>
              {allRuns.isError ? (
                <div className="mt-4 flex min-h-10 items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
                  <span>History is temporarily unavailable.</span>
                  <button
                    className="shrink-0 font-medium text-accent-700 hover:underline"
                    type="button"
                    onClick={() => void allRuns.refetch()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <RunHistoryStrip
                  className="mt-4"
                  max={historyLimit}
                  runs={historyRuns}
                  workspaceId={current.id}
                />
              )}
              <p className="mt-2 text-[11px] text-zinc-500">
                {allRuns.isPending
                  ? "Loading run history…"
                  : historyRuns.length === 0
                    ? "No runs yet"
                    : `${historyRuns.length} recent ${historyRuns.length === 1 ? "run" : "runs"}`}
              </p>
            </div>
          </div>

          <aside className="bg-zinc-50/70 p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Next scheduled run
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700">
                <CalendarClock aria-hidden="true" className="size-5" />
              </span>
              <div>
                <time
                  className="block text-xl font-semibold text-zinc-950"
                  dateTime={testData.nextRunAt}
                >
                  {formatRelative(testData.nextRunAt)}
                </time>
                <time
                  className="mt-0.5 block text-xs text-zinc-500"
                  dateTime={testData.nextRunAt}
                >
                  {formatDateTime(testData.nextRunAt, timezone)}
                </time>
              </div>
            </div>
            <dl className="mt-6 divide-y divide-zinc-200 border-t border-zinc-200 pt-3">
              <SummaryFact
                icon={<Clock3 aria-hidden="true" className="size-4" />}
                label="Schedule"
                value={formatInterval(testData.intervalHours)}
              />
              <SummaryFact
                icon={<Bell aria-hidden="true" className="size-4" />}
                label="Alert delivery"
                value={channelCountLabel(testData.channelIds.length)}
              />
              <SummaryFact
                icon={<RotateCcw aria-hidden="true" className="size-4" />}
                label="Retry policy"
                value={retryLabel(testData.maxRetries)}
              />
            </dl>
            <a
              className="mt-5 inline-flex text-xs font-medium text-accent-700 hover:underline"
              href="#test-setup"
            >
              View test setup ↓
            </a>
          </aside>
        </div>
      </Card>

      <Card className="overflow-hidden" padding="none">
        <div className="px-5 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Run history</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Open a run to inspect its attempts, evidence, and result.
              </p>
            </div>
            {runs.isSuccess ? <Badge tone="neutral">{rows.length} shown</Badge> : null}
          </div>
          <div className="mt-3">
            <Tabs
              label="Filter run history"
              items={[
                { key: "ALL", label: "All" },
                { key: "PASSED", label: "Passed" },
                { key: "FAILED", label: "Failed" },
                { key: "TIMEOUT", label: "Timeout" },
                { key: "SYSTEM_ERROR", label: "System error" },
              ]}
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
            <div className="hidden lg:block">
              <Table
                columns={runColumns(testData, timezone, current.id)}
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
            <div className="px-5 pb-5">
              <LoadMore
                loading={runs.isFetchingNextPage}
                nextCursor={nextRunCursor}
                onMore={() => void loadMoreRuns()}
              />
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
