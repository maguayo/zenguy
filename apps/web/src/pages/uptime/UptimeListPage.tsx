import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { deleteMonitor, listMonitors } from "../../api/uptime";
import type { Monitor } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown, type DropdownItem } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { IconButton } from "../../components/ui/IconButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { Table, type TableColumn } from "../../components/ui/Table";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { apiErrorMessage } from "../../lib/errors";
import { formatFrequency, formatRelative } from "../../lib/format";

export function monitorHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function MonitorActions({ monitor }: { monitor: Monitor }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can, current } = useWorkspace();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const remove = useMutation({ mutationFn: () => deleteMonitor(current.id, monitor.id) });

  const removeMonitor = async () => {
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "monitors"] });
      toast.success("Monitor deleted");
    } catch (error) {
      toast.error(apiErrorMessage(error));
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
      <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <Dropdown
          items={items}
          trigger={
            <IconButton aria-label={`Actions for ${monitor.name}`}>
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

export function uptimeColumns(
  workspaceId: string,
  renderActions?: (monitor: Monitor) => ReactNode,
): TableColumn<Monitor>[] {
  return [
    {
      header: "Status",
      key: "status",
      render: (monitor) => (
        <div className="flex min-w-32 flex-wrap items-center gap-1.5">
          <StatusBadge status={monitor.status} />
          {monitor.checking ? (
            <Badge tone="info">
              <span aria-hidden="true" className="motion-safe:animate-pulse size-1.5 rounded-full bg-current" />
              Checking
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      header: "Name",
      key: "name",
      render: (monitor) => (
        <div className="min-w-52">
          <p className="font-medium text-zinc-900">{monitor.name}</p>
          <p className="mt-0.5 max-w-72 truncate text-xs text-zinc-500">
            {monitorHost(monitor.url)}
          </p>
        </div>
      ),
    },
    {
      header: "Frequency",
      key: "frequency",
      render: (monitor) => (
        <span className="whitespace-nowrap">{formatFrequency(monitor.frequencySeconds)}</span>
      ),
    },
    {
      header: "Last check",
      key: "lastCheck",
      render: (monitor) =>
        monitor.lastCheckAt ? (
          <span className="whitespace-nowrap">{formatRelative(monitor.lastCheckAt)}</span>
        ) : (
          "—"
        ),
    },
    {
      className: "whitespace-nowrap",
      header: "Response",
      key: "response",
      render: (monitor) =>
        monitor.lastResponseTimeMs === null ? "—" : `${monitor.lastResponseTimeMs} ms`,
    },
    {
      header: "Incident",
      key: "incident",
      render: (monitor) =>
        monitor.openIncidentId ? (
          <Link
            className="inline-flex"
            to={`/w/${workspaceId}/incidents/${monitor.openIncidentId}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Badge tone="danger">Open</Badge>
          </Link>
        ) : (
          "—"
        ),
    },
    {
      className: "w-12 text-right",
      header: <span className="sr-only">Actions</span>,
      key: "actions",
      render: (monitor) => renderActions?.(monitor) ?? null,
    },
  ];
}

export default function UptimeListPage() {
  const navigate = useNavigate();
  const { can, current } = useWorkspace();
  const monitors = useQuery({
    queryFn: () => listMonitors(current.id),
    queryKey: ["ws", current.id, "monitors"],
    refetchInterval: 30_000,
  });
  const columns = uptimeColumns(current.id, (monitor) => (
    <MonitorActions monitor={monitor} />
  ));

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
        title="Uptime"
      />

      {monitors.isError ? (
        <ErrorState onRetry={() => void monitors.refetch()} />
      ) : (
        <Card className="overflow-hidden" padding="none">
          <Table
            columns={columns}
            empty={
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
            }
            loading={monitors.isPending}
            rowKey={(monitor) => monitor.id}
            rows={monitors.data ?? []}
            onRowClick={(monitor) => navigate(`/w/${current.id}/uptime/${monitor.id}`)}
          />
        </Card>
      )}
    </div>
  );
}
