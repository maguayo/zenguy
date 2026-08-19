import { useState, type ReactNode } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { listChannels } from "../../api/channels";
import { listIncidents } from "../../api/incidents";
import { deleteMonitor, getMonitor, getStats, listChecks } from "../../api/uptime";
import type { Check, Incident, MonitorStats } from "../../api/types";
import type { ApiPage } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { DescriptionList } from "../../components/ui/DescriptionList";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { LoadMore } from "../../components/ui/LoadMore";
import { PageHeader } from "../../components/ui/PageHeader";
import { Spinner } from "../../components/ui/Spinner";
import { Table, type TableColumn } from "../../components/ui/Table";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { apiErrorMessage } from "../../lib/errors";
import {
  formatDateTime,
  formatDuration,
  formatFrequency,
  formatPct,
  formatTime,
} from "../../lib/format";

type StatTone = "ok" | "warn" | "danger" | "neutral";

export function uptimeTone(value: number | null): StatTone {
  if (value === null) return "neutral";
  if (value >= 99.9) return "ok";
  if (value >= 99) return "warn";
  return "danger";
}

export function expectationSummary(input: {
  bodyCondition: "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "JSON_PATH_EQUALS" | null;
  bodyConditionPath: string | null;
  bodyExpectedValue: string | null;
  expectedStatus: number;
}): string {
  const parts = [`Status ${input.expectedStatus}`];
  const expected = input.bodyExpectedValue ?? "";
  if (input.bodyCondition === "CONTAINS") parts.push(`Body contains "${expected}"`);
  if (input.bodyCondition === "NOT_CONTAINS") parts.push(`Body does not contain "${expected}"`);
  if (input.bodyCondition === "EQUALS") parts.push(`Body equals "${expected}"`);
  if (input.bodyCondition === "JSON_PATH_EQUALS") {
    parts.push(`JSON path ${input.bodyConditionPath ?? "—"} equals "${expected}"`);
  }
  return parts.join(" · ");
}

const toneClasses: Record<StatTone, string> = {
  danger: "border-danger-600/25 bg-danger-50 text-danger-700",
  neutral: "border-zinc-200 bg-white text-zinc-900",
  ok: "border-ok-600/25 bg-ok-50 text-ok-700",
  warn: "border-warn-600/25 bg-warn-50 text-warn-600",
};

function StatCard({ children, title, tone = "neutral" }: { children: ReactNode; title: string; tone?: StatTone }) {
  return (
    <Card className={toneClasses[tone]}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-75">{title}</p>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{children}</div>
    </Card>
  );
}

function ResponseTimeTooltip({
  active,
  payload,
  timezone,
}: TooltipContentProps & { timezone: string }) {
  const point = payload?.[0]?.payload as MonitorStats["series"][number] | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-zinc-900">{formatTime(point.t, timezone)}</p>
      <p className="mt-1 text-zinc-600">
        {point.responseTimeMs === null ? "—" : `${point.responseTimeMs} ms`} · {point.status === "PASSED" ? "Passed" : "Failed"}
      </p>
    </div>
  );
}

function ResponseTimeChart({ series, timezone }: { series: MonitorStats["series"]; timezone: string }) {
  if (series.length === 0) {
    return <EmptyState className="min-h-56" title="Not enough data yet." />;
  }
  const failed = series
    .filter((point) => point.status === "FAILED")
    .map((point) => ({ ...point, responseTimeMs: point.responseTimeMs ?? 0 }));
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={series} margin={{ bottom: 0, left: -12, right: 8, top: 8 }}>
          <CartesianGrid stroke="#f4f4f5" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            interval="preserveStartEnd"
            minTickGap={40}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={(value: string) => formatTime(value, timezone)}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickLine={false}
            width={48}
          />
          <ChartTooltip
            content={(props) => <ResponseTimeTooltip {...props} timezone={timezone} />}
          />
          <Area
            connectNulls
            dataKey="responseTimeMs"
            fill="#4f46e5"
            fillOpacity={0.15}
            isAnimationActive={false}
            stroke="#4f46e5"
            strokeWidth={2}
            type="monotone"
          />
          <Scatter data={failed} dataKey="responseTimeMs" fill="#dc2626" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function checkColumns(timezone: string): TableColumn<Check>[] {
  return [
    {
      header: "Time",
      key: "time",
      render: (check) => <span className="whitespace-nowrap">{formatDateTime(check.checkedAt, timezone)}</span>,
    },
    {
      header: "Result",
      key: "result",
      render: (check) => <Badge tone={check.status === "PASSED" ? "ok" : "danger"}>{check.status === "PASSED" ? "Passed" : "Failed"}</Badge>,
    },
    { header: "HTTP status", key: "httpStatus", render: (check) => check.httpStatus ?? "—" },
    {
      header: "Response time",
      key: "responseTime",
      render: (check) => check.responseTimeMs === null ? "—" : `${check.responseTimeMs} ms`,
    },
    {
      header: "Reason",
      key: "reason",
      render: (check) => <span className="font-mono text-xs">{check.failureReason ?? "—"}</span>,
    },
  ];
}

export default function MonitorDetailPage() {
  const { monitorId = "" } = useParams();
  const { can, current, timezone } = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const monitor = useQuery({
    queryFn: () => getMonitor(current.id, monitorId),
    queryKey: ["ws", current.id, "monitors", monitorId],
    refetchInterval: 30_000,
  });
  const stats = useQuery({
    enabled: monitor.isSuccess,
    queryFn: () => getStats(current.id, monitorId),
    queryKey: ["ws", current.id, "monitors", monitorId, "stats"],
    refetchInterval: 60_000,
  });
  const checks = useInfiniteQuery<ApiPage<Check>>({
    enabled: monitor.isSuccess,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listChecks(current.id, monitorId, { cursor: pageParam as string | null, limit: 50 }),
    queryKey: ["ws", current.id, "monitors", monitorId, "checks"],
  });
  const incidents = useQuery({
    enabled: monitor.isSuccess,
    queryFn: () => listIncidents(current.id, { type: "uptime" }, null, 100),
    queryKey: ["ws", current.id, "incidents", { type: "uptime" }],
  });
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const remove = useMutation({ mutationFn: () => deleteMonitor(current.id, monitorId) });

  const deleteCurrentMonitor = async () => {
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "monitors"] });
      toast.success("Monitor deleted");
      navigate(`/w/${current.id}/uptime`, { replace: true });
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  if (monitor.isPending || channels.isPending) {
    return <div className="grid min-h-64 place-items-center"><Spinner label="Loading uptime monitor" size={6} /></div>;
  }
  if (monitor.isError) return <ErrorState onRetry={() => void monitor.refetch()} />;
  if (channels.isError) return <ErrorState onRetry={() => void channels.refetch()} />;

  const data = monitor.data;
  const channelNames = new Map(channels.data.map((channel) => [channel.id, channel.name]));
  const checkRows = checks.data?.pages.flatMap((page) => page.items) ?? [];
  const monitorIncidents = (incidents.data?.items ?? []).filter((incident) => incident.resourceId === data.id);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={can("uptime.manage") ? (
          <>
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              to={`/w/${current.id}/uptime/${data.id}/edit`}
            >
              <Pencil aria-hidden="true" className="size-4" /> Edit
            </Link>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 aria-hidden="true" className="size-4" /> Delete
            </Button>
          </>
        ) : undefined}
        description={new URL(data.url).host}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {data.name}
            <StatusBadge status={data.status} />
            {data.checking ? (
              <Badge tone="info"><span aria-hidden="true" className="motion-safe:animate-pulse size-1.5 rounded-full bg-current" />Checking</Badge>
            ) : null}
          </span>
        }
      />

      {data.openIncidentId ? (
        <Card className="border-danger-600/20 bg-danger-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium text-danger-700">This monitor has an open incident.</p>
            <Link className="text-sm font-medium text-danger-700 hover:underline" to={`/w/${current.id}/incidents/${data.openIncidentId}`}>
              View incident →
            </Link>
          </div>
        </Card>
      ) : null}

      {stats.isError ? (
        <ErrorState onRetry={() => void stats.refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Uptime 24 h" tone={uptimeTone(stats.data?.uptime24h ?? null)}>{stats.isPending ? "—" : formatPct(stats.data.uptime24h)}</StatCard>
          <StatCard title="Uptime 7 days" tone={uptimeTone(stats.data?.uptime7d ?? null)}>{stats.isPending ? "—" : formatPct(stats.data.uptime7d)}</StatCard>
          <StatCard title="Uptime 30 days" tone={uptimeTone(stats.data?.uptime30d ?? null)}>{stats.isPending ? "—" : formatPct(stats.data.uptime30d)}</StatCard>
          <StatCard title="Avg response (24 h)">{stats.isPending || stats.data.avgResponseTimeMs24h === null ? "—" : `${Math.round(stats.data.avgResponseTimeMs24h)} ms`}</StatCard>
        </div>
      )}

      <Card title="Response time (24 h)">
        {stats.isPending ? (
          <div className="grid h-[220px] place-items-center"><Spinner label="Loading response-time chart" /></div>
        ) : stats.isSuccess ? (
          <ResponseTimeChart series={stats.data.series} timezone={timezone} />
        ) : null}
      </Card>

      <Card className="overflow-hidden" padding="none">
        <div className="px-4 pt-4"><h2 className="text-sm font-semibold text-zinc-900">Recent checks</h2></div>
        {checks.isError ? (
          <ErrorState className="m-4" onRetry={() => void checks.refetch()} />
        ) : (
          <>
            <Table
              columns={checkColumns(timezone)}
              empty={<EmptyState className="m-4" description="Checks will appear after the first scheduled request." title="No checks yet" />}
              loading={checks.isPending}
              rowKey={(check) => check.id}
              rows={checkRows}
            />
            <div className="px-4 pb-4">
              <LoadMore
                loading={checks.isFetchingNextPage}
                nextCursor={checks.hasNextPage ? checks.data?.pages.at(-1)?.nextCursor ?? null : null}
                onMore={() => void checks.fetchNextPage()}
              />
            </div>
          </>
        )}
      </Card>

      <Card title="Incidents">
        {incidents.isPending ? (
          <Spinner label="Loading incidents" />
        ) : incidents.isError ? (
          <ErrorState onRetry={() => void incidents.refetch()} />
        ) : monitorIncidents.length === 0 ? (
          <p className="text-sm text-zinc-500">No incidents.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {monitorIncidents.map((incident: Incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <StatusBadge status={incident.status} />
                <span className="text-sm text-zinc-600">Opened {formatDateTime(incident.openedAt, timezone)} · {formatDuration(incident.durationMs)}</span>
                <Link className="ml-auto text-sm font-medium text-accent-700 hover:underline" to={`/w/${current.id}/incidents/${incident.id}`}>View →</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Configuration">
        <DescriptionList
          items={[
            { label: "Request", value: <span className="break-all font-mono text-xs">{data.method} {data.url}</span> },
            { label: "Expectations", value: expectationSummary(data) },
            { label: "Frequency", value: formatFrequency(data.frequencySeconds) },
            { label: "Timeout", value: `${data.timeoutSeconds} seconds` },
            { label: "Retries", value: `${data.maxRetries} ${data.maxRetries === 1 ? "retry" : "retries"}` },
            {
              label: "Notification channels",
              value: data.channelIds.length === 0 ? "None" : (
                <span className="flex flex-wrap gap-1">{data.channelIds.map((id) => <Badge key={id}>{channelNames.get(id) ?? "Unknown channel"}</Badge>)}</span>
              ),
            },
            { label: "Notify on recovery", value: data.notifyOnRecovery ? "Yes" : "No" },
          ]}
        />
      </Card>

      <ConfirmDialog
        body="Its check history stays available with any related incident."
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteCurrentMonitor}
        open={deleteOpen}
        title={`Delete "${data.name}"?`}
        tone="danger"
      />
    </div>
  );
}
