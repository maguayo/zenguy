import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Globe2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import clsx from "clsx";
import { Link, useNavigate } from "react-router-dom";

import { deleteMonitor, listMonitors } from "../../api/uptime";
import type { Monitor } from "../../api/types";
import { CheckPulseStrip, passRateLabel } from "../../components/PulseStrip";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
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
  formatFrequency,
  formatRelative,
} from "../../lib/format";

export function monitorHost(url: string): string {
  try {
    return new URL(url).host || "Unknown host";
  } catch {
    return "Unknown host";
  }
}

export function monitorAlertChannelsLabel(count: number): string {
  if (count === 0) return "No alert channels";
  return `${count} alert ${count === 1 ? "channel" : "channels"}`;
}

export function monitorResponseTimeLabel(value: number | null): string {
  return value === null ? "No response" : `${value} ms`;
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
  "Monitor",
  "History",
  "Next check",
  "Alerts",
] as const;

const uptimeListGrid =
  "min-[1200px]:grid-cols-[minmax(175px,1fr)_minmax(240px,1.5fr)_minmax(105px,0.62fr)_minmax(110px,0.68fr)_112px]";

function monitorIndicatorClass(monitor: Monitor): string {
  if (monitor.openIncidentId || monitor.status === "DOWN") {
    return "bg-danger-600";
  }
  if (monitor.checking) {
    return "bg-info-600 motion-safe:animate-pulse";
  }
  if (monitor.status === "UP") return "bg-ok-600";
  return "bg-zinc-400";
}

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

  return (
    <>
      <div className="min-w-0 pr-10 min-[1200px]:pr-0" role="cell">
        <div className="flex items-start gap-3">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700">
            <Activity
              aria-hidden="true"
              className={clsx(
                "size-5",
                monitor.checking && "motion-safe:animate-pulse",
              )}
            />
            <span
              aria-hidden="true"
              className={clsx(
                "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white",
                monitorIndicatorClass(monitor),
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              className="block truncate text-sm font-semibold text-zinc-950 hover:text-accent-700 hover:underline"
              to={`/w/${workspaceId}/uptime/${monitor.id}`}
            >
              {monitor.name}
            </Link>
            <p
              className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"
              title={host}
            >
              <Globe2 aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{host}</span>
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-zinc-500">
              {monitor.method}
            </p>
          </div>
        </div>
      </div>

      <div
        className="grid grid-cols-1 items-start gap-2 min-[400px]:grid-cols-[5.5rem_minmax(0,1fr)] min-[400px]:gap-3 min-[1200px]:block"
        role="cell"
      >
        <MobileCellLabel>History</MobileCellLabel>
        <div className="min-w-0 rounded-lg bg-zinc-50/90 p-2.5 ring-1 ring-inset ring-zinc-200">
          <div className="flex min-h-6 flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={monitor.status} />
              {monitor.checking ? <StatusBadge status="CHECKING" /> : null}
            </div>
          </div>
          <CheckPulseStrip
            checks={recentChecks}
            className="mt-2.5 w-full"
          />
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-xs font-semibold tabular-nums text-zinc-700">
              {passRateLabel(recentChecks) ?? "No checks yet"}
            </p>
            <span
              className="whitespace-nowrap text-[11px] text-zinc-500"
              title={
                monitor.lastCheckAt
                  ? formatDateTime(monitor.lastCheckAt, timezone)
                  : undefined
              }
            >
              {monitor.lastCheckAt
                ? `${formatRelative(monitor.lastCheckAt)} · ${monitorResponseTimeLabel(
                    monitor.lastResponseTimeMs,
                  )}`
                : "Waiting for first check"}
            </span>
          </div>
        </div>
      </div>

      <div
        className="grid grid-cols-1 items-start gap-2 min-[400px]:grid-cols-[5.5rem_minmax(0,1fr)] min-[400px]:gap-3 min-[1200px]:block"
        role="cell"
      >
        <MobileCellLabel>Next check</MobileCellLabel>
        <div>
          <p
            className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-zinc-900"
            title={formatDateTime(monitor.nextCheckAt, timezone)}
          >
            <CalendarClock aria-hidden="true" className="size-4 text-zinc-400" />
            {formatRelative(monitor.nextCheckAt)}
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">
            {formatFrequency(monitor.frequencySeconds)}
          </p>
        </div>
      </div>

      <div
        className="grid grid-cols-1 items-start gap-2 min-[400px]:grid-cols-[5.5rem_minmax(0,1fr)] min-[400px]:gap-3 min-[1200px]:block"
        role="cell"
      >
        <MobileCellLabel>Alerts</MobileCellLabel>
        <div className="space-y-1.5">
          {monitor.openIncidentId ? (
            <Link
              className="inline-flex"
              to={`/w/${workspaceId}/incidents/${monitor.openIncidentId}`}
            >
              <Badge tone="danger">
                <CircleAlert aria-hidden="true" className="size-3" />
                Open incident
              </Badge>
            </Link>
          ) : monitor.status === "UP" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ok-700">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              All clear
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600">
              <CheckCircle2 aria-hidden="true" className="size-3.5 text-zinc-400" />
              No open incident
            </span>
          )}
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Bell aria-hidden="true" className="size-3.5" />
            {monitorAlertChannelsLabel(monitor.channelIds.length)}
          </p>
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
          <div key={index} className="flex items-center gap-4 px-5 py-5">
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-32 max-w-full" />
            </div>
            <div className="hidden w-64 space-y-2 min-[1200px]:block">
              <Skeleton className="h-6 w-full rounded" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-6 w-20 min-[1200px]:block" />
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
  const navigate = useNavigate();
  const openMonitor = (monitorId: string) => {
    navigate(`/w/${workspaceId}/uptime/${monitorId}`);
  };

  return (
    <Card className="overflow-hidden" padding="none">
      <div aria-label="Uptime monitors" role="table">
        <div
          className="sr-only min-[1200px]:not-sr-only min-[1200px]:block min-[1200px]:border-b min-[1200px]:border-zinc-200 min-[1200px]:bg-zinc-50"
          role="rowgroup"
        >
          <div
            className={clsx(
              "grid items-center gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500",
              uptimeListGrid,
            )}
            role="row"
          >
            {uptimeListHeaders.map((header) => (
              <div key={header} role="columnheader">
                {header === "History" ? (
                  <span className="flex items-baseline gap-1.5">
                    <span>{header}</span>
                    <span className="text-[10px] font-normal normal-case tracking-normal text-zinc-400">
                      latest 20
                    </span>
                  </span>
                ) : (
                  header
                )}
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
                "relative grid cursor-pointer grid-cols-1 gap-x-4 gap-y-4 px-5 py-5 transition-colors hover:bg-zinc-50/80 min-[1200px]:items-center",
                uptimeListGrid,
              )}
              role="row"
              onClick={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("a, button")
                ) {
                  return;
                }
                openMonitor(monitor.id);
              }}
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
