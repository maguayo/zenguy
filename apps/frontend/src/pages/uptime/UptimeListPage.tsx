import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import clsx from "clsx";
import { Link, useNavigate } from "react-router-dom";

import { deleteMonitor, listMonitors } from "../../api/uptime";
import type { Monitor } from "../../api/types";
import { CheckPulseStrip, passRateLabel } from "../../components/PulseStrip";
import { StatusBadge } from "../../components/StatusBadge";
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
import { apiErrorMessage } from "../../lib/errors";
import {
  formatDateTime,
  formatRelative,
} from "../../lib/format";

export function monitorHost(url: string): string {
  try {
    return new URL(url).host || "Unknown host";
  } catch {
    return "Unknown host";
  }
}

export function monitorResponseTimeLabel(value: number | null): string {
  return value === null ? "No response" : `${value} ms`;
}

export function monitorFrequencyLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
  return `${seconds / 3_600} h`;
}

function MonitorActions({ monitor }: { monitor: Monitor }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const remove = useMutation({ mutationFn: () => deleteMonitor(current.id, monitor.id) });

  const removeMonitor = async () => {
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "monitors"] });
      toast.success("Monitor deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: DropdownItem[] = [
    {
      label: "Open",
      onSelect: () => navigate(`/w/${current.id}/uptime/${monitor.id}`),
    },
    ...(can("uptime.manage")
      ? [
          {
            label: "Edit",
            onSelect: () => navigate(`/w/${current.id}/uptime/${monitor.id}/edit`),
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
      <div className="flex items-center justify-end">
        <Dropdown
          items={items}
          trigger={
            <IconButton
              aria-label={`Actions for ${monitor.name}`}
              className="size-9"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </IconButton>
          }
        />
      </div>
      <ConfirmDialog
        body="Its check history stays available with any related incident."
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeMonitor}
        open={deleteOpen}
        title={`Delete "${monitor.name}"?`}
        tone="danger"
      />
    </>
  );
}

export const uptimeListHeaders = [
  "Status",
  "Monitor",
  "Every",
  "Response",
  "Last 20 checks",
] as const;

const uptimeListGrid =
  "min-[1200px]:grid-cols-[92px_minmax(190px,1.2fr)_84px_110px_minmax(180px,1fr)_44px]";

function MobileCellLabel({ children }: { children: string }) {
  return (
    <p className="pt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 min-[1200px]:hidden">
      {children}
    </p>
  );
}

export function MonitorRowContent({
  monitor,
  timezone,
  workspaceId,
}: {
  monitor: Monitor;
  timezone: string;
  workspaceId: string;
}) {
  const host = monitorHost(monitor.url);
  const recentChecks = (monitor.recentChecks ?? []).slice(-20);
  const historyLabel = passRateLabel(recentChecks) ?? "No checks yet";

  return (
    <>
      <div className="flex flex-col items-start gap-1.5" role="cell">
        <StatusBadge status={monitor.status} />
        {monitor.checking ? <StatusBadge status="CHECKING" /> : null}
        {monitor.openIncidentId ? (
          <Link
            className="inline-flex items-center gap-1 text-[11px] font-medium text-danger-700 hover:underline"
            to={`/w/${workspaceId}/incidents/${monitor.openIncidentId}`}
          >
            <CircleAlert aria-hidden="true" className="size-3" />
            Incident
          </Link>
        ) : null}
      </div>

      <div className="min-w-0 pr-10 min-[1200px]:pr-0" role="cell">
        <div className="flex min-w-0 flex-col gap-1 min-[1200px]:flex-row min-[1200px]:items-baseline min-[1200px]:gap-2.5">
          <Link
            className="min-w-0 truncate text-sm font-semibold text-zinc-950 hover:text-accent-700 hover:underline min-[1200px]:max-w-[58%] min-[1200px]:shrink-0"
            to={`/w/${workspaceId}/uptime/${monitor.id}`}
          >
            {monitor.name}
          </Link>
          <p
            className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-zinc-500"
            title={host}
          >
            <span className="min-[1200px]:hidden">{monitor.method} ·</span>
            <span className="truncate">{host}</span>
          </p>
        </div>
      </div>

      <div
        className="min-w-0"
        role="cell"
      >
        <MobileCellLabel>Every</MobileCellLabel>
        <p className="mt-1 font-mono text-sm tabular-nums text-zinc-800 min-[1200px]:mt-0">
          {monitorFrequencyLabel(monitor.frequencySeconds)}
        </p>
        <p
          className="mt-1 whitespace-nowrap text-[11px] text-zinc-500"
          title={formatDateTime(monitor.nextCheckAt, timezone)}
        >
          Next {formatRelative(monitor.nextCheckAt)}
        </p>
      </div>

      <div
        className="min-w-0"
        role="cell"
      >
        <MobileCellLabel>Response</MobileCellLabel>
        <p className="mt-1 whitespace-nowrap font-mono text-sm tabular-nums text-zinc-800 min-[1200px]:mt-0">
          {monitor.lastCheckAt
            ? monitorResponseTimeLabel(monitor.lastResponseTimeMs)
            : "—"}
        </p>
        <p
          className="mt-1 whitespace-nowrap text-[11px] text-zinc-500"
          title={
            monitor.lastCheckAt
              ? formatDateTime(monitor.lastCheckAt, timezone)
              : undefined
          }
        >
          {monitor.lastCheckAt
            ? formatRelative(monitor.lastCheckAt)
            : "Waiting for first check"}
        </p>
      </div>

      <div
        className="col-span-2 min-w-0 min-[1200px]:col-span-1"
        role="cell"
      >
        <MobileCellLabel>Last 20 checks</MobileCellLabel>
        <CheckPulseStrip
          ariaLabel={`Last 20 checks for ${monitor.name}: ${historyLabel}; newest on the right`}
          checks={recentChecks}
          className="mt-2 min-[1200px]:mt-0"
          density="compact"
        />
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500 min-[1200px]:sr-only">
          <span>{historyLabel}</span>
          <span>Newest on right</span>
        </div>
      </div>
    </>
  );
}

function UptimeListSkeleton() {
  return (
    <Card
      aria-label="Loading uptime monitors"
      className="overflow-hidden"
      padding="none"
      role="status"
    >
      <div className="divide-y divide-zinc-200">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className={clsx(
              "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-5 py-4",
              uptimeListGrid,
            )}
          >
            <Skeleton className="h-6 w-16 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
            <Skeleton className="hidden h-5 w-14 min-[1200px]:block" />
            <Skeleton className="hidden h-5 w-16 min-[1200px]:block" />
            <Skeleton className="col-span-2 h-[18px] w-full min-[1200px]:col-span-1 min-[1200px]:block" />
            <Skeleton className="hidden size-8 min-[1200px]:block" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function UptimeMonitorList({
  monitors,
  timezone,
  workspaceId,
}: {
  monitors: Monitor[];
  timezone: string;
  workspaceId: string;
}) {
  return (
    <Card className="overflow-hidden shadow-sm" padding="none">
      <div aria-label="Uptime monitors" role="table">
        <div
          className="sr-only min-[1200px]:not-sr-only min-[1200px]:block min-[1200px]:border-b min-[1200px]:border-zinc-200 min-[1200px]:bg-zinc-50"
          role="rowgroup"
        >
          <div
            className={clsx(
              "grid items-center gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500",
              "font-mono",
              uptimeListGrid,
            )}
            role="row"
          >
            {uptimeListHeaders.map((header) => (
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
          {monitors.map((monitor) => (
            <div
              key={monitor.id}
              className={clsx(
                "relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4 px-5 py-4 transition-colors hover:bg-zinc-50/70 min-[1200px]:items-center",
                uptimeListGrid,
              )}
              role="row"
            >
              <MonitorRowContent
                monitor={monitor}
                timezone={timezone}
                workspaceId={workspaceId}
              />
              <div
                className="absolute right-4 top-4 min-[1200px]:static min-[1200px]:self-center"
                role="cell"
              >
                <MonitorActions monitor={monitor} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function UptimeListPage() {
  const { can, current, timezone } = useWorkspace();
  const monitors = useQuery({
    queryFn: () => listMonitors(current.id),
    queryKey: ["ws", current.id, "monitors"],
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          can("uptime.manage") ? (
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
              to={`/w/${current.id}/uptime/new`}
            >
              <Plus aria-hidden="true" className="size-4" />
              New monitor
            </Link>
          ) : undefined
        }
        description="Scheduled endpoint checks with incident tracking and alerts."
        title="Uptime"
      />

      {monitors.isError ? (
        <ErrorState onRetry={() => void monitors.refetch()} />
      ) : monitors.isPending ? (
        <UptimeListSkeleton />
      ) : monitors.data.length === 0 ? (
        <Card className="overflow-hidden" padding="none">
          <EmptyState
            action={
              can("uptime.manage") ? (
                <Link
                  className="inline-flex h-9 items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
                  to={`/w/${current.id}/uptime/new`}
                >
                  Create your first monitor
                </Link>
              ) : undefined
            }
            className="m-4"
            description="Ping an endpoint on a schedule and get alerted when it goes down. Uptime checks never consume runs."
            title="No uptime monitors yet"
          />
        </Card>
      ) : (
        <UptimeMonitorList
          monitors={monitors.data}
          timezone={timezone}
          workspaceId={current.id}
        />
      )}
    </div>
  );
}
