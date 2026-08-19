import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { listIncidents, type IncidentFilters } from "../../api/incidents";
import type { Incident } from "../../api/types";
import type { ApiPage } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Input } from "../../components/ui/Input";
import { LoadMore } from "../../components/ui/LoadMore";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Table, type TableColumn } from "../../components/ui/Table";
import { Tabs } from "../../components/ui/Tabs";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { formatDateTime, formatDuration, formatRelative } from "../../lib/format";

export type IncidentStatusTab = "open" | "resolved" | "all";
export type IncidentTypeFilter = "all" | "browser" | "uptime";
export const openIncidentsDescription =
  "Everything is passing. Incidents appear here when a test or monitor fails after all retries.";

export function parseIncidentStatus(value: string | null): IncidentStatusTab {
  return value === "resolved" || value === "all" ? value : "open";
}

export function parseIncidentType(value: string | null): IncidentTypeFilter {
  return value === "browser" || value === "uptime" ? value : "all";
}

export function nextIncidentSearchParams(
  current: URLSearchParams,
  key: "status" | "type" | "from" | "to",
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const defaultValue = key === "status" ? "open" : key === "type" ? "all" : "";
  if (!value || value === defaultValue) next.delete(key);
  else next.set(key, value);
  return next;
}

export function liveIncidentDuration(incident: Incident, now: number): number {
  return incident.status === "OPEN"
    ? Math.max(0, now - new Date(incident.openedAt).getTime())
    : incident.durationMs;
}

export function incidentColumns(timezone: string, now: number): TableColumn<Incident>[] {
  return [
    {
      header: "Resource",
      key: "resource",
      render: (incident) => (
        <div className="min-w-52">
          <p className="font-medium text-zinc-900">{incident.resourceName}</p>
          <Badge className="mt-1" tone={incident.resourceType === "BROWSER_TEST" ? "info" : "accent"}>
            {incident.resourceType === "BROWSER_TEST" ? "Browser test" : "Uptime monitor"}
          </Badge>
        </div>
      ),
    },
    {
      header: "Status",
      key: "status",
      render: (incident) => <StatusBadge status={incident.status} />,
    },
    {
      header: "Opened",
      key: "opened",
      render: (incident) => <span className="whitespace-nowrap">{formatDateTime(incident.openedAt, timezone)}</span>,
    },
    {
      header: "Duration",
      key: "duration",
      render: (incident) => <span className="whitespace-nowrap">{formatDuration(liveIncidentDuration(incident, now))}</span>,
    },
    {
      header: "Last event",
      key: "lastEvent",
      render: (incident) => <span className="whitespace-nowrap">{formatRelative(incident.lastEventAt)}</span>,
    },
  ];
}

export default function IncidentsPage() {
  const { current, timezone } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [now, setNow] = useState(Date.now());
  const status = parseIncidentStatus(searchParams.get("status"));
  const type = parseIncidentType(searchParams.get("type"));
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const filters: IncidentFilters = {
    ...(status === "all" ? {} : { status }),
    ...(type === "all" ? {} : { type }),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const incidents = useInfiniteQuery<ApiPage<Incident>>({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listIncidents(current.id, filters, pageParam as string | null),
    queryKey: ["ws", current.id, "incidents", filters],
    refetchInterval: status === "open" ? 30_000 : false,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const setFilter = (key: "status" | "type" | "from" | "to", value: string) => {
    setSearchParams(nextIncidentSearchParams(searchParams, key, value), { replace: true });
  };

  const rows = incidents.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Incidents" />

      <Card padding="none">
        <div className="px-4 pt-3">
          <Tabs
            items={[
              { key: "open", label: "Open" },
              { key: "resolved", label: "Resolved" },
              { key: "all", label: "All" },
            ]}
            value={status}
            onChange={(value) => setFilter("status", value)}
          />
        </div>
        <div className="grid gap-3 border-b border-zinc-200 p-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-sm font-medium text-zinc-900">
            <span>Type</span>
            <Select value={type} onChange={(event) => setFilter("type", event.target.value)}>
              <option value="all">All types</option>
              <option value="browser">Browser tests</option>
              <option value="uptime">Uptime monitors</option>
            </Select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-zinc-900">
            <span>From</span>
            <Input type="date" value={from} onChange={(event) => setFilter("from", event.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-zinc-900">
            <span>To</span>
            <Input type="date" value={to} onChange={(event) => setFilter("to", event.target.value)} />
          </label>
        </div>

        {incidents.isError ? (
          <ErrorState className="m-4" onRetry={() => void incidents.refetch()} />
        ) : (
          <>
            <Table
              columns={incidentColumns(timezone, now)}
              empty={
                status === "open" ? (
                  <EmptyState
                    className="m-4 border-ok-600/30 bg-ok-50"
                    description={openIncidentsDescription}
                    icon={<CheckCircle2 aria-hidden="true" className="size-7 text-ok-700" />}
                    title="No open incidents"
                  />
                ) : (
                  <EmptyState className="m-4" title="No incidents found" />
                )
              }
              loading={incidents.isPending}
              rowKey={(incident) => incident.id}
              rows={rows}
              onRowClick={(incident) => navigate(`/w/${current.id}/incidents/${incident.id}`)}
            />
            <div className="px-4 pb-4">
              <LoadMore
                loading={incidents.isFetchingNextPage}
                nextCursor={incidents.hasNextPage ? incidents.data?.pages.at(-1)?.nextCursor ?? null : null}
                onMore={() => void incidents.fetchNextPage()}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
