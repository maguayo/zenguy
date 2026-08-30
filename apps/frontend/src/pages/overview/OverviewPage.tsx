import { useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BellOff,
  CheckCircle2,
  ChevronRight,
  Clock,
  Globe,
  HeartPulse,
  Siren,
  Wrench,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { Link } from "react-router-dom";

import { listIncidents } from "../../api/incidents";
import { getOverview } from "../../api/overview";
import type { ActivityItem, ActivityType, Incident, Usage } from "../../api/types";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { formatCurrency, formatDateTime, formatRelative } from "../../lib/format";
import { OverviewHero } from "./OverviewHero";

interface ActivityPresentation {
  className: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true"; className?: string }>;
  label: string;
}

export const activityPresentation: Record<ActivityType, ActivityPresentation> = {
  TEST_PASSED: {
    className: "bg-ok-50 text-ok-700",
    icon: CheckCircle2,
    label: "Passed",
  },
  TEST_FAILED: {
    className: "bg-danger-50 text-danger-700",
    icon: XCircle,
    label: "Failed",
  },
  TEST_TIMEOUT: {
    className: "bg-warn-50 text-warn-600",
    icon: Clock,
    label: "Timed out",
  },
  TEST_SYSTEM_ERROR: {
    className: "bg-zinc-100 text-zinc-600",
    icon: Wrench,
    label: "System error",
  },
  TEST_RECOVERED: {
    className: "bg-ok-50 text-ok-700",
    icon: HeartPulse,
    label: "Recovered",
  },
  MONITOR_DOWN: {
    className: "bg-danger-50 text-danger-700",
    icon: Siren,
    label: "Down",
  },
  MONITOR_RECOVERED: {
    className: "bg-ok-50 text-ok-700",
    icon: HeartPulse,
    label: "Recovered",
  },
  CHANNEL_DELIVERY_FAILED: {
    className: "bg-warn-50 text-warn-600",
    icon: BellOff,
    label: "Delivery failed",
  },
};

export function activityResourceLabel(resourceType: string): string {
  if (resourceType === "BROWSER_TEST") return "Browser test";
  if (resourceType === "UPTIME_MONITOR") return "Uptime monitor";
  if (resourceType === "NOTIFICATION_CHANNEL") return "Notification channel";
  return "Workspace activity";
}

export function activityPath(workspaceId: string, item: ActivityItem): string {
  if (item.link.runId) return `/w/${workspaceId}/runs/${item.link.runId}`;
  if (item.link.incidentId) return `/w/${workspaceId}/incidents/${item.link.incidentId}`;
  if (item.link.monitorId) return `/w/${workspaceId}/uptime/${item.link.monitorId}`;
  if (item.link.channelId) return `/w/${workspaceId}/notifications?channel=${item.link.channelId}`;
  return `/w/${workspaceId}/overview`;
}

export function activityKey(item: ActivityItem): string {
  return `${item.id}:${item.type}:${item.occurredAt}`;
}

export function uptimeMetric(value: number | null | undefined): {
  unit: "%" | null;
  value: string;
} {
  if (value === null || value === undefined) return { unit: null, value: "—" };
  return {
    unit: "%",
    value: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value),
  };
}

type MetricTone = "danger" | "neutral" | "ok" | "warn";

const metricSupportClass: Record<MetricTone, string> = {
  danger: "text-danger-700",
  neutral: "text-zinc-500",
  ok: "text-ok-700",
  warn: "text-warn-600",
};

function MetricCard({
  label,
  support,
  tone = "neutral",
  unit,
  value,
}: {
  label: string;
  support: ReactNode;
  tone?: MetricTone;
  unit?: string | null;
  value: ReactNode;
}) {
  return (
    <Card className="min-h-30 rounded-xl">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5 tabular-nums">
        <span className="text-3xl font-semibold tracking-tight text-zinc-950">{value}</span>
        {unit ? <span className="text-xs font-medium text-zinc-500">{unit}</span> : null}
      </p>
      <p className={clsx("mt-1.5 text-xs font-medium", metricSupportClass[tone])}>{support}</p>
    </Card>
  );
}

function shortCycleDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(date);
}

function OverviewUsage({ timezone, usage }: { timezone: string; usage: Usage }) {
  const percentage = Math.min(
    100,
    Math.max(0, (usage.billableRuns / usage.includedRuns) * 100),
  );
  const barClass =
    usage.overageRuns > 0
      ? "bg-danger-600"
      : percentage >= 80
        ? "bg-warn-600"
        : "bg-accent-600";

  return (
    <Card className="rounded-xl" title="Usage this cycle">
      <p className="flex items-baseline gap-2 tabular-nums">
        <span className="text-3xl font-semibold tracking-tight text-zinc-950">
          {usage.billableRuns}
        </span>
        <span className="text-sm font-medium text-zinc-500">of {usage.includedRuns} runs</span>
      </p>
      <div
        aria-label={`${usage.billableRuns} of ${usage.includedRuns} runs used`}
        aria-valuemax={usage.includedRuns}
        aria-valuemin={0}
        aria-valuenow={Math.min(usage.billableRuns, usage.includedRuns)}
        className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"
        role="progressbar"
      >
        <div
          className={clsx("h-full rounded-full transition-[width]", barClass)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <dl className="mt-2.5 flex items-center justify-between gap-4 text-xs text-zinc-500">
        <div>
          <dt className="sr-only">Remaining runs</dt>
          <dd>{usage.remainingRuns} remaining</dd>
        </div>
        <div className="text-right">
          <dt className="sr-only">Cycle renewal</dt>
          <dd>Renews {shortCycleDate(usage.periodEnd, timezone)}</dd>
        </div>
      </dl>
      <p className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        Projected total{" "}
        <strong className="font-semibold text-zinc-900">
          {formatCurrency(usage.projectedTotalCents, usage.currency)}
        </strong>
        {usage.overageRuns > 0
          ? ` · ${usage.overageRuns} extra ${usage.overageRuns === 1 ? "run" : "runs"}`
          : null}
      </p>
    </Card>
  );
}

function heroIncident(page: { items: Incident[] } | undefined): Incident | null | undefined {
  return page === undefined ? undefined : (page.items[0] ?? null);
}

function OverviewSkeleton() {
  return (
    <div aria-label="Loading overview" className="space-y-5" role="status">
      <Skeleton className="h-21 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card className="min-h-30 rounded-xl" key={index}>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-4 h-8 w-24" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { can, current, timezone } = useWorkspace();
  const [showAllActivity, setShowAllActivity] = useState(false);
  const overview = useQuery({
    queryFn: () => getOverview(current.id),
    queryKey: ["ws", current.id, "overview"],
    refetchInterval: 30_000,
  });
  const openIncidents = overview.data
    ? overview.data.browserTests.openIncidents + overview.data.uptime.openIncidents
    : 0;
  const watchedChecks = overview.data
    ? overview.data.browserTests.total +
      overview.data.uptime.up +
      overview.data.uptime.down +
      overview.data.uptime.unknown
    : 0;
  const openIncidentQuery = useQuery({
    enabled: overview.isSuccess && openIncidents > 0,
    queryFn: () => listIncidents(current.id, { status: "open" }, null, 1),
    queryKey: ["ws", current.id, "incidents", "hero", "open"],
    refetchInterval: 30_000,
  });
  const lastIncidentQuery = useQuery({
    enabled: overview.isSuccess && openIncidents === 0 && watchedChecks > 0,
    queryFn: () => listIncidents(current.id, {}, null, 1),
    queryKey: ["ws", current.id, "incidents", "hero", "last"],
    refetchInterval: 30_000,
  });

  if (overview.isPending) return <OverviewSkeleton />;
  if (overview.isError) return <ErrorState onRetry={() => void overview.refetch()} />;

  const data = overview.data;
  const monitorCount = data.uptime.up + data.uptime.down + data.uptime.unknown;
  const uptime = uptimeMetric(data.uptime.uptime30d);
  const uptimeTone: MetricTone =
    data.uptime.uptime30d === null || data.uptime.uptime30d === undefined
      ? "neutral"
      : data.uptime.uptime30d >= 99.9
        ? "ok"
        : data.uptime.uptime30d >= 99
          ? "warn"
          : "danger";
  const visibleActivity = showAllActivity ? data.activity : data.activity.slice(0, 4);

  return (
    <div className="space-y-5">
      <OverviewHero
        canManageTests={can("tests.manage")}
        lastIncident={heroIncident(lastIncidentQuery.data)}
        openIncident={heroIncident(openIncidentQuery.data)}
        overview={data}
        workspaceId={current.id}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Uptime · 30 days"
          support={
            monitorCount === 0
              ? "No monitors yet"
              : data.uptime.uptime30d === null || data.uptime.uptime30d === undefined
                ? "Collecting availability data"
                : `${monitorCount} ${monitorCount === 1 ? "monitor" : "monitors"} measured`
          }
          tone={uptimeTone}
          unit={uptime.unit}
          value={uptime.value}
        />
        <MetricCard
          label="Avg response · 24 h"
          support={
            data.uptime.avgResponseTimeMs24h === null
              ? "No response data yet"
              : "Across all uptime monitors"
          }
          unit={data.uptime.avgResponseTimeMs24h === null ? null : "ms"}
          value={
            data.uptime.avgResponseTimeMs24h === null
              ? "—"
              : Math.round(data.uptime.avgResponseTimeMs24h)
          }
        />
        <MetricCard
          label="Failures · 24 h"
          support={data.browserTests.failed24h === 0 ? "No failed runs" : "Review recent failures"}
          tone={data.browserTests.failed24h === 0 ? "ok" : "danger"}
          value={data.browserTests.failed24h}
        />
        <MetricCard
          label="Open incidents"
          support={openIncidents === 0 ? "All clear" : "Needs attention"}
          tone={openIncidents === 0 ? "ok" : "danger"}
          value={openIncidents}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <OverviewUsage timezone={timezone} usage={data.usage} />

        <Card className="overflow-hidden rounded-xl" padding="none">
          <div className="flex min-h-13 items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-zinc-900">Recent activity</h2>
            {data.activity.length > 4 ? (
              <button
                aria-controls="overview-activity-list"
                aria-expanded={showAllActivity}
                className="text-xs font-medium text-accent-700 underline-offset-4 hover:underline"
                type="button"
                onClick={() => setShowAllActivity((visible) => !visible)}
              >
                {showAllActivity ? "Show less" : "View all"}
              </button>
            ) : data.activity.length > 0 ? (
              <span className="text-xs text-zinc-400">
                {data.activity.length} {data.activity.length === 1 ? "event" : "events"}
              </span>
            ) : null}
          </div>
          {data.activity.length === 0 ? (
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
              description="Create your first browser test to see activity here."
              icon={<Globe aria-hidden="true" className="size-6" />}
              title="No activity yet"
            />
          ) : (
            <ul className="divide-y divide-zinc-100" id="overview-activity-list">
              {visibleActivity.map((item) => {
                const presentation = activityPresentation[item.type];
                const Icon = presentation.icon;
                const relative = formatRelative(item.occurredAt);
                return (
                  <li key={activityKey(item)}>
                    <Link
                      aria-label={`${item.resourceName}: ${presentation.label}, ${relative}`}
                      className="group grid min-h-14 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50/70 focus-visible:bg-zinc-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-600"
                      to={activityPath(current.id, item)}
                    >
                      <span
                        className={clsx(
                          "grid size-7 shrink-0 place-items-center rounded-full",
                          presentation.className,
                        )}
                      >
                        <Icon aria-hidden="true" className="size-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-zinc-700">
                          <strong
                            className="font-semibold text-zinc-900 group-hover:text-accent-700"
                            title={item.resourceName}
                          >
                            {item.resourceName}
                          </strong>
                          <span> · {presentation.label}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {activityResourceLabel(item.resourceType)}
                          <span aria-hidden="true" className="sm:hidden">
                            {" "}·{" "}
                          </span>
                          <time
                            className="sm:hidden"
                            dateTime={item.occurredAt}
                            title={formatDateTime(item.occurredAt, timezone)}
                          >
                            {relative}
                          </time>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <time
                          className="hidden text-xs text-zinc-500 sm:block"
                          dateTime={item.occurredAt}
                          title={formatDateTime(item.occurredAt, timezone)}
                        >
                          {relative}
                        </time>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3.5 text-zinc-400 transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function browserTestNoun(count: number): "test" | "tests" {
  return count === 1 ? "test" : "tests";
}
