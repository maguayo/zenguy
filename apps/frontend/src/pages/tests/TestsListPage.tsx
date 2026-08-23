import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Download,
  Globe2,
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
import type { BrowserTest, RunSource } from "../../api/types";
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
  formatInterval,
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
            className="hidden lg:inline-flex"
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

export const testListHeaders = ["Test", "Last run", "Next run", "Alerts"] as const;

const testListGrid =
  "lg:grid-cols-[minmax(260px,1.7fr)_minmax(155px,0.85fr)_minmax(135px,0.72fr)_minmax(165px,0.9fr)_auto]";

export function testHost(url: string): string {
  try {
    return new URL(url).host || "Unknown host";
  } catch {
    return "Unknown host";
  }
}

export function alertChannelsLabel(count: number): string {
  if (count === 0) return "No alert channels";
  return `${count} alert ${count === 1 ? "channel" : "channels"}`;
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

function indicatorClass(test: BrowserTest): string {
  if (test.openIncidentId) return "bg-danger-600";
  switch (test.lastRun?.status) {
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
      return "bg-zinc-400";
  }
}

function MobileCellLabel({ children }: { children: string }) {
  return (
    <p className="pt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 lg:hidden">
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

  return (
    <>
      <div className="min-w-0 pr-10 lg:pr-0" role="cell">
        <div className="flex items-start gap-3">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700">
            <DeviceIcon aria-hidden="true" className="size-5" />
            <span
              aria-hidden="true"
              className={clsx(
                "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white",
                indicatorClass(test),
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              className="block truncate text-sm font-semibold text-zinc-950 hover:text-accent-700 hover:underline"
              to={`/w/${workspaceId}/tests/${test.id}`}
            >
              {test.name}
            </Link>
            <p
              className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"
              title={testHost(test.startUrl)}
            >
              <Globe2 aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{testHost(test.startUrl)}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600">
                <DeviceIcon aria-hidden="true" className="size-3" />
                {deviceLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600">
                <CalendarClock aria-hidden="true" className="size-3" />
                {formatInterval(test.intervalHours)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 lg:block"
        role="cell"
      >
        <MobileCellLabel>Last run</MobileCellLabel>
        <div className="min-w-0">
          {test.lastRun ? (
            <StatusBadge
              passedAfterRetry={test.lastRun.passedAfterRetry}
              status={test.lastRun.status}
            />
          ) : (
            <Badge tone="neutral">Not run yet</Badge>
          )}
          <p
            className="mt-1.5 whitespace-nowrap text-xs text-zinc-500"
            title={lastRunAt ? formatDateTime(lastRunAt, timezone) : undefined}
          >
            {lastRunAt ? formatRelative(lastRunAt) : "Waiting for first run"}
            {test.lastRun?.durationMs !== null && test.lastRun?.durationMs !== undefined
              ? ` · ${formatDuration(test.lastRun.durationMs)}`
              : null}
            {test.lastRun ? ` · ${runSourceLabel(test.lastRun.source)}` : null}
          </p>
        </div>
      </div>

      <div
        className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 lg:block"
        role="cell"
      >
        <MobileCellLabel>Next run</MobileCellLabel>
        <div>
          <p
            className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-zinc-900"
            title={formatDateTime(test.nextRunAt, timezone)}
          >
            <CalendarClock aria-hidden="true" className="size-4 text-zinc-400" />
            {formatRelative(test.nextRunAt)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Automatic</p>
        </div>
      </div>

      <div
        className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 lg:block"
        role="cell"
      >
        <MobileCellLabel>Alerts</MobileCellLabel>
        <div className="space-y-1.5">
          {test.openIncidentId ? (
            <Link
              className="inline-flex"
              to={`/w/${workspaceId}/incidents/${test.openIncidentId}`}
            >
              <Badge tone="danger">
                <CircleAlert aria-hidden="true" className="size-3" />
                Open incident
              </Badge>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ok-700">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              All clear
            </span>
          )}
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Bell aria-hidden="true" className="size-3.5" />
            {alertChannelsLabel(test.channelIds.length)}
          </p>
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
          <div key={index} className="flex items-center gap-3 px-4 py-4">
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
            <Skeleton className="hidden h-6 w-20 sm:block" />
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
  const navigate = useNavigate();

  return (
    <Card className="overflow-hidden" padding="none">
      <div aria-label="Browser tests" role="table">
        <div
          className="hidden border-b border-zinc-200 bg-zinc-50/80 lg:block"
          role="rowgroup"
        >
          <div
            className={clsx(
              "grid items-center gap-6 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500",
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
                "relative grid cursor-pointer grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 transition-colors hover:bg-zinc-50/80",
                testListGrid,
              )}
              role="row"
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("a, button")) return;
                navigate(`/w/${workspaceId}/tests/${test.id}`);
              }}
            >
              <TestRowContent
                test={test}
                timezone={timezone}
                workspaceId={workspaceId}
              />
              <div
                className="absolute right-3 top-3 lg:static lg:self-center"
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
