import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Play } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { listChannels } from "../../api/channels";
import { deleteTest, getTest, listRuns } from "../../api/tests";
import type { BrowserTest, RunListItem, RunStatus } from "../../api/types";
import { CopyButton } from "../../components/CopyButton";
import { RunSourceBadge } from "../../components/RunSourceBadge";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { DescriptionList } from "../../components/ui/DescriptionList";
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
import { useRunNow } from "./hooks";

const filterStatuses = ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const;
type RunFilter = "ALL" | (typeof filterStatuses)[number];

export function parseRunFilter(value: string | null): RunFilter {
  return filterStatuses.includes(value as (typeof filterStatuses)[number])
    ? (value as RunFilter)
    : "ALL";
}

function SummaryCard({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <Card title={title}>
      <div className="text-sm text-zinc-700">{children}</div>
    </Card>
  );
}

function runColumns(
  test: BrowserTest,
  timezone: string,
): TableColumn<RunListItem>[] {
  return [
    {
      header: "Date",
      key: "date",
      render: (run) => (
        <span className="whitespace-nowrap">{formatDateTime(run.createdAt, timezone)}</span>
      ),
    },
    {
      header: "Source",
      key: "source",
      render: (run) => <RunSourceBadge source={run.source} />,
    },
    {
      header: "Status",
      key: "status",
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
      render: (run) => run.triggeredBy?.name ?? "—",
    },
    {
      header: "Billable",
      key: "billable",
      render: (run) => (run.billable ? "1 run" : "—"),
    },
  ];
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
  const runs = useInfiniteQuery<ApiPage<RunListItem>>({
    enabled: test.isSuccess,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listRuns(current.id, testId, { cursor: pageParam as string | null, status }),
    queryKey: ["ws", current.id, "tests", testId, "runs", { status }],
  });
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
  const rows = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const lastRun = testData.lastRun;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            {can("tests.run") ? (
              <Button disabled={run.pending} variant="primary" onClick={run.requestRun}>
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
                    <IconButton aria-label={`More actions for ${testData.name}`}>
                      <MoreHorizontal aria-hidden="true" className="size-4" />
                    </IconButton>
                  }
                />
              </>
            ) : null}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {testData.name}
            {lastRun ? (
              <StatusBadge
                passedAfterRetry={lastRun.passedAfterRetry}
                status={lastRun.status}
              />
            ) : null}
          </span>
        }
      />

      {testData.openIncidentId ? (
        <Card className="border-danger-600/20 bg-danger-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium text-danger-700">This test has an open incident.</p>
            <Link
              className="text-sm font-medium text-danger-700 hover:underline"
              to={`/w/${current.id}/incidents/${testData.openIncidentId}`}
            >
              View incident →
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Last result">
          {lastRun ? (
            <div className="space-y-2">
              <StatusBadge
                passedAfterRetry={lastRun.passedAfterRetry}
                status={lastRun.status}
              />
              <p className="text-xs text-zinc-500">
                {lastRun.finishedAt ? formatRelative(lastRun.finishedAt) : "In progress"} ·{" "}
                {formatDuration(lastRun.durationMs)}
              </p>
            </div>
          ) : (
            "Never run"
          )}
        </SummaryCard>
        <SummaryCard title="Next run">
          <p className="font-medium text-zinc-900">{formatRelative(testData.nextRunAt)}</p>
        </SummaryCard>
        <SummaryCard title="Schedule">
          <p className="font-medium text-zinc-900">{formatInterval(testData.intervalHours)}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {testData.device === "DESKTOP" ? "Desktop" : "Mobile"}
          </p>
        </SummaryCard>
        <SummaryCard title="Retries">
          <p className="font-medium text-zinc-900">
            {testData.maxRetries} {testData.maxRetries === 1 ? "retry" : "retries"}
          </p>
        </SummaryCard>
      </div>

      <Card title="Configuration">
        <DescriptionList
          items={[
            {
              label: "Starting URL",
              value: (
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate" title={testData.startUrl}>
                    {testData.startUrl}
                  </span>
                  <CopyButton label="Copy starting URL" text={testData.startUrl} />
                </span>
              ),
            },
            {
              label: "Device",
              value:
                testData.device === "DESKTOP"
                  ? "Desktop · 1440 × 900"
                  : "Mobile · 390 × 844",
            },
            {
              label: "Instructions",
              value: (
                <div>
                  <p
                    className={`whitespace-pre-wrap break-words ${
                      instructionsExpanded ? "" : "line-clamp-6"
                    }`}
                  >
                    {testData.instructions}
                  </p>
                  <button
                    className="mt-1 text-xs font-medium text-accent-700 hover:underline"
                    type="button"
                    onClick={() => setInstructionsExpanded((value) => !value)}
                  >
                    {instructionsExpanded ? "Show less" : "Show more"}
                  </button>
                </div>
              ),
            },
            {
              label: "Notification channels",
              value:
                testData.channelIds.length === 0 ? (
                  "None"
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {testData.channelIds.map((channelId) => (
                      <Badge key={channelId}>{channelNames.get(channelId) ?? "Unknown channel"}</Badge>
                    ))}
                  </span>
                ),
            },
            {
              label: "Notify on recovery",
              value: testData.notifyOnRecovery ? "Yes" : "No",
            },
          ]}
        />
      </Card>

      <Card className="overflow-hidden" padding="none">
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold text-zinc-900">Runs</h2>
          <Tabs
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
        {runs.isError ? (
          <ErrorState className="m-4" onRetry={() => void runs.refetch()} />
        ) : (
          <>
            <Table
              columns={runColumns(testData, timezone)}
              empty={
                <EmptyState
                  className="m-4"
                  description="Run it now or wait for the schedule."
                  title="No runs yet"
                />
              }
              loading={runs.isPending}
              rowKey={(item) => item.id}
              rows={rows}
              onRowClick={(item) => navigate(`/w/${current.id}/runs/${item.id}`)}
            />
            <div className="px-4 pb-4">
              <LoadMore
                loading={runs.isFetchingNextPage}
                nextCursor={runs.hasNextPage ? runs.data?.pages.at(-1)?.nextCursor ?? null : null}
                onMore={() => void runs.fetchNextPage()}
              />
            </div>
          </>
        )}
      </Card>

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
