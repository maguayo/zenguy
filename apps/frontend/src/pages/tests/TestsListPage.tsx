import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  Download,
  Laptop,
  MoreHorizontal,
  Play,
  Plus,
  Smartphone,
  Upload,
} from "lucide-react";
import clsx from "clsx";
import { Link, useNavigate } from "react-router-dom";

import {
  deleteTest,
  exportTests,
  importTests,
  listTests,
  type ExportFormat,
  type ImportTestsSummary,
} from "../../api/tests";
import type { BrowserTest, RunSource, RunStatus } from "../../api/types";
import { passRateLabel, PulseStrip } from "../../components/PulseStrip";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown, type DropdownItem } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { IconButton } from "../../components/ui/IconButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { RemoteAiConsentBanner } from "../../components/RemoteAiConsentBanner";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { saveBlob } from "../../lib/download";
import { apiErrorMessage } from "../../lib/errors";
import {
  formatDateTime,
  formatDuration,
  formatRelative,
} from "../../lib/format";
import { isActiveRun, useRunNow } from "./hooks";

export function importSummaryMessage(
  summary: Pick<ImportTestsSummary, "created" | "updated">,
): string {
  return `Import complete: ${summary.created} created, ${summary.updated} updated`;
}

export function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.details && error.details.length > 0) {
    const shown = error.details
      .slice(0, 3)
      .map((detail) => `${detail.field}: ${detail.message}`)
      .join("; ");
    const remaining = error.details.length - 3;
    return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
  }
  return apiErrorMessage(error);
}

function TestActions({ test }: { test: BrowserTest }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const run = useRunNow(test);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const remove = useMutation({ mutationFn: () => deleteTest(current.id, test.id) });

  const removeTest = async () => {
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success("Test deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: DropdownItem[] = [
    {
      label: "Open",
      onSelect: () => navigate(`/w/${current.id}/tests/${test.id}`),
    },
    ...(can("tests.run")
      ? [
          {
            disabled: isActiveRun(test) || run.pending,
            label: "Run now",
            onSelect: run.requestRun,
          },
        ]
      : []),
    ...(can("tests.manage")
      ? [
          {
            label: "Edit",
            onSelect: () => navigate(`/w/${current.id}/tests/${test.id}/edit`),
          },
          {
            label: "Delete",
            onSelect: () => setDeleteOpen(true),
            tone: "danger" as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        {can("tests.run") ? (
          <Button
            aria-label={`Run ${test.name} now`}
            className="max-[1199px]:hidden"
            disabled={isActiveRun(test) || run.pending}
            size="sm"
            onClick={run.requestRun}
          >
            <Play aria-hidden="true" className="size-3.5" />
            Run
          </Button>
        ) : null}
        <Dropdown
          items={items}
          trigger={
            <IconButton
              aria-label={`Actions for ${test.name}`}
              className="size-9"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </IconButton>
          }
        />
      </div>
      <ConfirmDialog {...run.dialogProps} />
      <ConfirmDialog
        body="Its history stays available for 30 days."
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeTest}
        open={deleteOpen}
        title={`Delete "${test.name}"?`}
        tone="danger"
      />
    </>
  );
}

export const testListHeaders = [
  "Status",
  "Test",
  "Every",
  "Last run",
  "Last 20 runs",
] as const;

export const testListGrid =
  "min-[1200px]:grid-cols-[128px_minmax(165px,1.05fr)_78px_126px_minmax(165px,1fr)_112px]";

export function testHost(url: string): string {
  try {
    return new URL(url).host || "Unknown host";
  } catch {
    return "Unknown host";
  }
}

export function testIntervalLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  return `${hours} h`;
}

export function runSourceLabel(source: RunSource): string {
  switch (source) {
    case "MANUAL":
      return "Manual";
    case "VALIDATION":
      return "Validation";
    case "SCHEDULED":
      return "Scheduled";
  }
}

export function testStatus(test: BrowserTest): RunStatus | null {
  return test.recentRuns?.at(-1)?.status ?? test.lastRun?.status ?? null;
}

export function runHistoryCaption(runs: readonly { status: RunStatus }[]): string {
  const rate = passRateLabel(runs);
  if (rate) return rate;
  if (runs.length === 0) return "No runs yet";
  if (runs.some((run) => run.status === "QUEUED" || run.status === "RUNNING")) {
    return "Run in progress";
  }
  return "No completed runs";
}

function MobileCellLabel({ children }: { children: string }) {
  return (
    <p className="pt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 min-[1200px]:hidden">
      {children}
    </p>
  );
}

export function TestRowContent({
  test,
  timezone,
  workspaceId,
}: {
  test: BrowserTest;
  timezone: string;
  workspaceId: string;
}) {
  const DeviceIcon = test.device === "DESKTOP" ? Laptop : Smartphone;
  const deviceLabel = test.device === "DESKTOP" ? "Desktop" : "Mobile";
  const lastRunAt =
    test.lastRun?.finishedAt ?? test.lastRun?.startedAt ?? test.lastRun?.createdAt;
  const recentRuns = (test.recentRuns ?? []).slice(-20);
  const currentStatus = testStatus(test);
  const latestRun = recentRuns.at(-1);
  const historyLabel = runHistoryCaption(recentRuns);
  const lastRunDetails = test.lastRun
    ? [
        test.lastRun.durationMs === null
          ? null
          : formatDuration(test.lastRun.durationMs),
        runSourceLabel(test.lastRun.source),
      ]
        .filter(Boolean)
        .join(" · ")
    : "Waiting for first run";

  return (
    <>
      <div
        className="col-span-2 flex flex-col items-start gap-1.5 pr-10 min-[480px]:col-span-1 min-[480px]:pr-0 min-[1200px]:col-span-1"
        role="cell"
      >
        {currentStatus ? (
          <StatusBadge
            passedAfterRetry={Boolean(
              test.lastRun?.passedAfterRetry &&
                (latestRun === undefined || latestRun.id === test.lastRun.id),
            )}
            status={currentStatus}
          />
        ) : (
          <Badge tone="neutral">Not run yet</Badge>
        )}
        {test.openIncidentId ? (
          <Link
            className="inline-flex items-center gap-1 text-[11px] font-medium text-danger-700 hover:underline"
            to={`/w/${workspaceId}/incidents/${test.openIncidentId}`}
          >
            <CircleAlert aria-hidden="true" className="size-3" />
            Incident
          </Link>
        ) : null}
      </div>

      <div
        className="col-span-2 min-w-0 min-[480px]:col-span-1 min-[480px]:pr-10 min-[1200px]:col-span-1 min-[1200px]:pr-0"
        role="cell"
      >
        <Link
          className="block truncate text-sm font-semibold text-zinc-950 hover:text-accent-700 hover:underline"
          to={`/w/${workspaceId}/tests/${test.id}`}
        >
          {test.name}
        </Link>
        <p
          className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-zinc-500"
          title={`${deviceLabel} · ${testHost(test.startUrl)}`}
        >
          <DeviceIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">
            {deviceLabel} · {testHost(test.startUrl)}
          </span>
        </p>
      </div>

      <div className="min-w-0" role="cell">
        <MobileCellLabel>Every</MobileCellLabel>
        <p className="mt-1 font-mono text-sm tabular-nums text-zinc-800 min-[1200px]:mt-0">
          {testIntervalLabel(test.intervalHours)}
        </p>
        <p
          className="mt-1 whitespace-nowrap text-[11px] text-zinc-500"
          title={formatDateTime(test.nextRunAt, timezone)}
        >
          Next {formatRelative(test.nextRunAt)}
        </p>
      </div>

      <div className="min-w-0" role="cell">
        <MobileCellLabel>Last run</MobileCellLabel>
        <p
          className="mt-1 whitespace-nowrap font-mono text-sm tabular-nums text-zinc-800 min-[1200px]:mt-0"
          title={lastRunAt ? formatDateTime(lastRunAt, timezone) : undefined}
        >
          {lastRunAt ? formatRelative(lastRunAt) : "—"}
        </p>
        <p className="mt-1 truncate text-[11px] text-zinc-500" title={lastRunDetails}>
          {lastRunDetails}
        </p>
      </div>

      <div
        className="col-span-2 min-w-0 min-[1200px]:col-span-1"
        role="cell"
      >
        <MobileCellLabel>Last 20 runs</MobileCellLabel>
        <PulseStrip
          className="mt-2 w-full min-[1200px]:mt-0"
          density="compact"
          runs={recentRuns}
          workspaceId={workspaceId}
        />
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500 min-[1200px]:sr-only">
          <span>{historyLabel}</span>
          <span>Newest on right</span>
        </div>
      </div>
    </>
  );
}

function TestsListSkeleton() {
  return (
    <Card
      aria-label="Loading browser tests"
      className="overflow-hidden"
      padding="none"
      role="status"
    >
      <div className="divide-y divide-zinc-200">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className={clsx(
              "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-5 py-4",
              testListGrid,
            )}
          >
            <Skeleton className="h-6 w-20 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
            <Skeleton className="hidden h-5 w-12 min-[1200px]:block" />
            <Skeleton className="hidden h-5 w-20 min-[1200px]:block" />
            <Skeleton className="col-span-2 h-[18px] w-full min-[1200px]:col-span-1 min-[1200px]:block" />
            <Skeleton className="hidden h-8 w-24 min-[1200px]:block" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function BrowserTestsList({
  tests,
  timezone,
  workspaceId,
}: {
  tests: BrowserTest[];
  timezone: string;
  workspaceId: string;
}) {
  return (
    <Card className="overflow-hidden shadow-sm" padding="none">
      <div aria-label="Browser tests" role="table">
        <div
          className="sr-only min-[1200px]:not-sr-only min-[1200px]:block min-[1200px]:border-b min-[1200px]:border-zinc-200 min-[1200px]:bg-zinc-50"
          role="rowgroup"
        >
          <div
            className={clsx(
              "grid items-center gap-4 px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-wide text-zinc-500",
              testListGrid,
            )}
            role="row"
          >
            {testListHeaders.map((header) => (
              <div key={header} role="columnheader">
                {header}
              </div>
            ))}
            <div className="sr-only" role="columnheader">
              Actions
            </div>
          </div>
        </div>
        <div className="divide-y divide-zinc-200" role="rowgroup">
          {tests.map((test) => (
            <div
              key={test.id}
              className={clsx(
                "relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4 px-5 py-4 transition-colors hover:bg-zinc-50/70 min-[1200px]:items-center",
                testListGrid,
              )}
              role="row"
            >
              <TestRowContent
                test={test}
                timezone={timezone}
                workspaceId={workspaceId}
              />
              <div
                className="absolute right-4 top-4 min-[1200px]:static min-[1200px]:self-center"
                role="cell"
              >
                <TestActions test={test} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function TestsListPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current, timezone } = useWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const tests = useQuery({
    queryFn: () => listTests(current.id),
    queryKey: ["ws", current.id, "tests"],
    refetchInterval: 30_000,
  });
  const importFile = useMutation({
    mutationFn: (text: string) => importTests(current.id, text),
  });

  const runImport = async (file: File) => {
    try {
      const summary = await importFile.mutateAsync(await file.text());
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success(importSummaryMessage(summary));
    } catch (error) {
      if (!handleMutationError(error)) toast.error(importErrorMessage(error));
    }
  };

  const runExport = async (format: ExportFormat) => {
    try {
      const { blob, filename } = await exportTests(current.id, format);
      saveBlob(blob, filename);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const canManage = can("tests.manage");
  const hasTests = (tests.data?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          canManage || hasTests ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {hasTests ? (
                <Dropdown
                  align="end"
                  items={[
                    {
                      label: "Export as YAML",
                      onSelect: () => void runExport("yaml"),
                    },
                    {
                      label: "Export as JSON",
                      onSelect: () => void runExport("json"),
                    },
                  ]}
                  trigger={
                    <Button>
                      <Download aria-hidden="true" className="size-4" />
                      Export
                    </Button>
                  }
                />
              ) : null}
              {canManage ? (
                <>
                  <input
                    ref={fileInput}
                    accept=".yaml,.yml,.json"
                    className="hidden"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void runImport(file);
                    }}
                  />
                  <Button
                    loading={importFile.isPending}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload aria-hidden="true" className="size-4" />
                    Import
                  </Button>
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
                    to={`/w/${current.id}/tests/new`}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    New test
                  </Link>
                </>
              ) : null}
            </div>
          ) : undefined
        }
        description="Scheduled customer journeys, checked in a fresh browser on every run."
        title="Browser Tests"
      />

      <RemoteAiConsentBanner />

      {tests.isError ? (
        <ErrorState onRetry={() => void tests.refetch()} />
      ) : tests.isPending ? (
        <TestsListSkeleton />
      ) : tests.data.length === 0 ? (
        <Card className="overflow-hidden" padding="none">
          <EmptyState
            action={
              can("tests.manage") ? (
                <Link
                  className="inline-flex h-9 items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
                  to={`/w/${current.id}/tests/new`}
                >
                  Create your first test
                </Link>
              ) : undefined
            }
            className="m-4"
            description="Describe a flow in plain language and Zenguy will verify it in a real browser on a schedule."
            title="No browser tests yet"
          />
        </Card>
      ) : (
        <BrowserTestsList
          tests={tests.data}
          timezone={timezone}
          workspaceId={current.id}
        />
      )}
    </div>
  );
}
