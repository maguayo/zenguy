import { useState, type ReactNode } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  Bell,
  ChevronRight,
  CircleAlert,
  Clock3,
  Globe2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Timer,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { listChannels } from "../../api/channels";
import { listIncidents } from "../../api/incidents";
import { deleteMonitor, getMonitor, getStats, listChecks } from "../../api/uptime";
import type { Check, Incident, Monitor } from "../../api/types";
import type { ApiPage } from "../../lib/api";
import { CheckPulseStrip, passRateLabel } from "../../components/PulseStrip";
import { StatusBadge } from "../../components/StatusBadge";
import { ResponseTimeChart } from "../../components/uptime/ResponseTimeChart";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { DescriptionList } from "../../components/ui/DescriptionList";
import { Dropdown } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { IconButton } from "../../components/ui/IconButton";
import { LoadMore } from "../../components/ui/LoadMore";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Spinner } from "../../components/ui/Spinner";
import { Table, type TableColumn } from "../../components/ui/Table";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { apiErrorMessage, itemQueryErrorMessage } from "../../lib/errors";
import {
  formatDateTime,
  formatDuration,
  formatFrequency,
  formatPct,
  formatRelative,
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

export function monitorHeaderLines(
  monitor: Pick<Monitor, "headers" | "headersMasked">,
): string[] {
  if (monitor.headersMasked) return ["Masked for your role"];
  if (!monitor.headers || monitor.headers.length === 0) return ["None"];
  return monitor.headers.map((header) => `${header.key}: ${header.value}`);
}

const metricToneClasses: Record<StatTone, string> = {
  danger: "text-danger-700",
  neutral: "text-zinc-950",
  ok: "text-ok-700",
  warn: "text-warn-600",
};

const checkHistoryLimit = 20;

/** The checks endpoint is newest-first; the visual timeline reads oldest-to-newest. */
export function recentCheckHistory(
  checks: readonly Check[],
  max = checkHistoryLimit,
): Check[] {
  return checks.slice(0, max).reverse();
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Metric({
  children,
  className,
  label,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  label: string;
  tone?: StatTone;
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={`mt-1.5 text-2xl font-semibold tabular-nums ${metricToneClasses[tone]}`}>
        {children}
      </dd>
    </div>
  );
}

function OverviewFact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
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

export function checkColumns(timezone: string): TableColumn<Check>[] {
  return [
    {
      className: "min-w-52",
      header: "Time",
      key: "time",
      render: (check) => (
        <div className="whitespace-nowrap">
          <time className="font-medium text-zinc-900" dateTime={check.checkedAt}>
            {formatRelative(check.checkedAt)}
          </time>
          <time className="mt-0.5 block text-xs text-zinc-500" dateTime={check.checkedAt}>
            {formatDateTime(check.checkedAt, timezone)}
          </time>
        </div>
      ),
    },
    {
      header: "Result",
      key: "result",
      render: (check) => <Badge tone={check.status === "PASSED" ? "ok" : "danger"}>{check.status === "PASSED" ? "Passed" : "Failed"}</Badge>,
    },
    {
      header: "HTTP status",
      key: "httpStatus",
      render: (check) => <span className="tabular-nums text-zinc-700">{check.httpStatus ?? "—"}</span>,
    },
    {
      header: "Response time",
      key: "responseTime",
      render: (check) => (
        <span className="font-medium tabular-nums text-zinc-900">
          {check.responseTimeMs === null ? "—" : `${check.responseTimeMs} ms`}
        </span>
      ),
    },
    {
      header: "Reason",
      key: "reason",
      render: (check) => (
        <span className="block max-w-sm whitespace-normal font-mono text-xs text-zinc-600">
          {check.failureReason ?? "—"}
        </span>
      ),
    },
  ];
}

export default function MonitorDetailPage() {
  const { monitorId = "" } = useParams();
  const { can, current, timezone } = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const handleMutationError = useMutationError();
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
  const recentChecks = useQuery({
    enabled: monitor.isSuccess,
    queryFn: () =>
      listChecks(current.id, monitorId, { limit: checkHistoryLimit }),
    queryKey: ["ws", current.id, "monitors", monitorId, "checks", "recent"],
    refetchInterval: 30_000,
  });
  const checks = useInfiniteQuery<ApiPage<Check>>({
    enabled: monitor.isSuccess,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listChecks(current.id, monitorId, {
        cursor: pageParam as string | null,
        limit: checkHistoryLimit,
      }),
    queryKey: ["ws", current.id, "monitors", monitorId, "checks", "log"],
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
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  if (monitor.isPending || channels.isPending) {
    return <div className="grid min-h-64 place-items-center"><Spinner label="Loading uptime monitor" size={6} /></div>;
  }
  if (monitor.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(monitor.error)}
        onRetry={() => void monitor.refetch()}
      />
    );
  }
  if (channels.isError) return <ErrorState onRetry={() => void channels.refetch()} />;

  const data = monitor.data;
  const channelNames = new Map(channels.data.map((channel) => [channel.id, channel.name]));
  const checkRows = checks.data?.pages.flatMap((page) => page.items) ?? [];
  const monitorIncidents = (incidents.data?.items ?? []).filter((incident) => incident.resourceId === data.id);
  const headerLines = monitorHeaderLines(data);
  const historyChecks = recentCheckHistory(recentChecks.data?.items ?? []);
  const historyRate = passRateLabel(historyChecks);
  const lastCheckSummary = data.lastCheckAt
    ? [
        formatRelative(data.lastCheckAt),
        data.lastResponseTimeMs === null ? "No response" : `${data.lastResponseTimeMs} ms`,
      ].join(" · ")
    : "not run yet";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"
        >
          <Link
            className="shrink-0 hover:text-zinc-900 hover:underline"
            to={`/w/${current.id}/uptime`}
          >
            Uptime
          </Link>
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
          <span aria-current="page" className="truncate text-zinc-700">
            {data.name}
          </span>
        </nav>
        <PageHeader
          actions={can("uptime.manage") ? (
            <>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                to={`/w/${current.id}/uptime/${data.id}/edit`}
              >
                <Pencil aria-hidden="true" className="size-4" /> Edit
              </Link>
              <Dropdown
                items={[
                  {
                    icon: <Trash2 className="size-4" />,
                    label: "Delete",
                    onSelect: () => setDeleteOpen(true),
                    tone: "danger",
                  },
                ]}
                trigger={
                  <IconButton aria-label={`More actions for ${data.name}`}>
                    <MoreHorizontal aria-hidden="true" className="size-4" />
                  </IconButton>
                }
              />
            </>
          ) : undefined}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Globe2 aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{hostLabel(data.url)}</span>
              </span>
              <span aria-hidden="true" className="text-zinc-300">·</span>
              <span>{data.method}</span>
              <span aria-hidden="true" className="text-zinc-300">·</span>
              <span>{formatFrequency(data.frequencySeconds)}</span>
            </span>
          }
          title={data.name}
        />
      </div>

      {data.openIncidentId ? (
        <Card className="border-danger-600/20 bg-danger-50">
          <div className="flex flex-wrap items-center justify-between gap-3 text-danger-700">
            <p className="flex items-center gap-2 font-medium">
              <CircleAlert aria-hidden="true" className="size-4" />
              This monitor has an open incident.
            </p>
            <Link className="text-sm font-medium text-danger-700 hover:underline" to={`/w/${current.id}/incidents/${data.openIncidentId}`}>
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
                className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                  data.status === "UP"
                    ? "bg-ok-50 text-ok-700"
                    : data.status === "DOWN"
                      ? "bg-danger-50 text-danger-700"
                      : "bg-zinc-100 text-zinc-600"
                }`}
              >
                <Activity aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Current health
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={data.status} />
                  {data.checking ? (
                    <Badge tone="info">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
                      />
                      Checking
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-zinc-500">Last check {lastCheckSummary}</p>
              </div>
              {historyRate ? <Badge tone="accent">{historyRate}</Badge> : null}
            </div>

            <div className="mt-5 rounded-xl bg-zinc-50/90 p-4 ring-1 ring-inset ring-zinc-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">Recent checks</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Last {checkHistoryLimit} attempts, oldest to newest
                  </p>
                </div>
                <span className="text-[11px] font-medium text-zinc-400">Newest →</span>
              </div>
              {recentChecks.isError ? (
                <div className="mt-4 flex min-h-10 items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
                  <span>Check history is temporarily unavailable.</span>
                  <button
                    className="shrink-0 font-medium text-accent-700 hover:underline"
                    type="button"
                    onClick={() => void recentChecks.refetch()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <CheckPulseStrip
                  checks={historyChecks}
                  className="mt-4"
                  max={checkHistoryLimit}
                />
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-zinc-500">
                <span>
                  {recentChecks.isError
                    ? "History unavailable"
                    : recentChecks.isPending
                      ? "Loading check history…"
                      : historyChecks.length === 0
                        ? "No checks yet"
                        : `${historyChecks.length} recent ${historyChecks.length === 1 ? "attempt" : "attempts"}`}
                </span>
                <span className="flex flex-wrap items-center gap-3" aria-label="Check history legend">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 w-1 rounded-sm bg-ok-600" /> Passed
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 w-1 rounded-sm bg-danger-600" /> Failed
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-3 w-1 rounded-sm bg-zinc-200" /> No data
                  </span>
                </span>
              </div>
            </div>
          </div>

          <aside className="bg-zinc-50/70 p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Next scheduled check
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700">
                <Clock3 aria-hidden="true" className="size-5" />
              </span>
              <div>
                <time
                  className="block text-xl font-semibold text-zinc-950"
                  dateTime={data.nextCheckAt}
                >
                  {formatRelative(data.nextCheckAt)}
                </time>
                <time
                  className="mt-0.5 block text-xs text-zinc-500"
                  dateTime={data.nextCheckAt}
                >
                  {formatDateTime(data.nextCheckAt, timezone)}
                </time>
              </div>
            </div>
            <dl className="mt-5 divide-y divide-zinc-200 border-t border-zinc-200 pt-3">
              <OverviewFact
                icon={<RotateCcw aria-hidden="true" className="size-4" />}
                label="Frequency"
                value={formatFrequency(data.frequencySeconds)}
              />
              <OverviewFact
                icon={<Timer aria-hidden="true" className="size-4" />}
                label="Timeout"
                value={`${data.timeoutSeconds} seconds`}
              />
              <OverviewFact
                icon={<Bell aria-hidden="true" className="size-4" />}
                label="Alert delivery"
                value={
                  data.channelIds.length === 0
                    ? "No channels"
                    : `${data.channelIds.length} alert ${data.channelIds.length === 1 ? "channel" : "channels"}`
                }
              />
            </dl>
          </aside>
        </div>

        <dl className="grid grid-cols-2 border-t border-zinc-200 lg:grid-cols-4">
          <Metric
            className="border-r border-zinc-200 p-4 sm:px-6 sm:py-5"
            label="Uptime 24 h"
            tone={uptimeTone(stats.data?.uptime24h ?? null)}
          >
            {stats.isPending ? (
              <Skeleton className="h-8 w-20" />
            ) : stats.isSuccess ? (
              formatPct(stats.data.uptime24h)
            ) : (
              "—"
            )}
          </Metric>
          <Metric
            className="p-4 sm:px-6 sm:py-5 lg:border-r lg:border-zinc-200"
            label="Uptime 7 days"
            tone={uptimeTone(stats.data?.uptime7d ?? null)}
          >
            {stats.isPending ? (
              <Skeleton className="h-8 w-20" />
            ) : stats.isSuccess ? (
              formatPct(stats.data.uptime7d)
            ) : (
              "—"
            )}
          </Metric>
          <Metric
            className="border-r border-t border-zinc-200 p-4 sm:px-6 sm:py-5 lg:border-t-0"
            label="Uptime 30 days"
            tone={uptimeTone(stats.data?.uptime30d ?? null)}
          >
            {stats.isPending ? (
              <Skeleton className="h-8 w-20" />
            ) : stats.isSuccess ? (
              formatPct(stats.data.uptime30d)
            ) : (
              "—"
            )}
          </Metric>
          <Metric
            className="border-t border-zinc-200 p-4 sm:px-6 sm:py-5 lg:border-t-0"
            label="Avg response · 24 h"
          >
            {stats.isPending ? (
              <Skeleton className="h-8 w-24" />
            ) : stats.isSuccess && stats.data.avgResponseTimeMs24h !== null ? (
              `${Math.round(stats.data.avgResponseTimeMs24h)} ms`
            ) : (
              "—"
            )}
          </Metric>
        </dl>
        {stats.isError ? (
          <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-warn-50 px-5 py-2.5 text-xs text-warn-600">
            <span>Availability metrics are temporarily unavailable.</span>
            <button
              className="font-medium hover:underline"
              type="button"
              onClick={() => void stats.refetch()}
            >
              Retry
            </button>
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden" padding="none">
        {stats.isPending ? (
          <div className="grid h-[280px] place-items-center">
            <Spinner label="Loading response-time chart" />
          </div>
        ) : stats.isError ? (
          <ErrorState className="m-5" onRetry={() => void stats.refetch()} />
        ) : (
          <div className="p-5 sm:p-6">
            <ResponseTimeChart
              averageMs={stats.data.avgResponseTimeMs24h}
              series={stats.data.series}
              timezone={timezone}
            />
          </div>
        )}
      </Card>

      <Card className="overflow-hidden" padding="none">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">Check log</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Request evidence for every attempt, newest first.
            </p>
          </div>
          {checks.isSuccess ? <Badge tone="neutral">{checkRows.length} shown</Badge> : null}
        </div>
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
          <EmptyState className="min-h-32" title="No incidents." />
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
            {
              label: "Headers",
              value: (
                <span className="block space-y-1 font-mono text-xs">
                  {headerLines.map((line, index) => (
                    <span className="block break-all" key={`${line}-${index}`}>{line}</span>
                  ))}
                </span>
              ),
            },
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
