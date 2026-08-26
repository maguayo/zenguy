import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BellOff,
  CheckCircle2,
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
import type { ActivityItem, ActivityType, Incident } from "../../api/types";
import { UsageMeter } from "../../components/UsageMeter";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { formatRelative } from "../../lib/format";
import { OverviewHero } from "./OverviewHero";

interface ActivityPresentation {
  className: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true"; className?: string }>;
}

export const activityPresentation: Record<ActivityType, ActivityPresentation> = {
  TEST_PASSED: { className: "bg-ok-50 text-ok-700", icon: CheckCircle2 },
  TEST_FAILED: { className: "bg-danger-50 text-danger-700", icon: XCircle },
  TEST_TIMEOUT: { className: "bg-warn-50 text-warn-600", icon: Clock },
  TEST_SYSTEM_ERROR: { className: "bg-zinc-100 text-zinc-600", icon: Wrench },
  TEST_RECOVERED: { className: "bg-ok-50 text-ok-700", icon: HeartPulse },
  MONITOR_DOWN: { className: "bg-danger-50 text-danger-700", icon: Siren },
  MONITOR_RECOVERED: { className: "bg-ok-50 text-ok-700", icon: HeartPulse },
  CHANNEL_DELIVERY_FAILED: { className: "bg-warn-50 text-warn-600", icon: BellOff },
};

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

function StatRow({
  danger = false,
  label,
  value,
}: {
  danger?: boolean;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="flex items-center gap-2 text-zinc-500">
        <span
          aria-hidden="true"
          className={clsx("size-2 rounded-full", danger ? "bg-danger-600" : "bg-zinc-300")}
        />
        {label}
      </span>
      <span className={clsx("font-medium", danger ? "text-danger-700" : "text-zinc-900")}>
        {value}
      </span>
    </div>
  );
}

function heroIncident(page: { items: Incident[] } | undefined): Incident | null | undefined {
  return page === undefined ? undefined : (page.items[0] ?? null);
}

function OverviewSkeleton() {
  return (
    <div aria-label="Loading overview" className="space-y-6" role="status">
      <Skeleton className="h-48 rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-5 h-8 w-36" />
            <div className="mt-5 space-y-3">
              <Skeleton className="h-4" />
              <Skeleton className="h-4" />
              <Skeleton className="h-4" />
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <Skeleton className="h-4 w-32" />
        <div className="mt-5 space-y-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </Card>
    </div>
  );
}

export default function OverviewPage() {
  const { can, current, timezone } = useWorkspace();
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

  return (
    <div className="space-y-6">
      <OverviewHero
        canManageTests={can("tests.manage")}
        lastIncident={heroIncident(lastIncidentQuery.data)}
        openIncident={heroIncident(openIncidentQuery.data)}
        overview={data}
        workspaceId={current.id}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Usage this cycle">
          <UsageMeter timezone={timezone} usage={data.usage} />
        </Card>

        <Card className="flex flex-col" title="Browser tests">
          <p className="text-3xl font-semibold tracking-tight text-zinc-950">
            {data.browserTests.total}
            <span className="ml-2 text-sm font-normal text-zinc-500">
              {` ${browserTestNoun(data.browserTests.total)}`}
            </span>
          </p>
          <div className="mt-5 flex-1 space-y-3">
            <StatRow label="Running now" value={data.browserTests.runningRuns} />
            <StatRow
              danger={data.browserTests.openIncidents > 0}
              label="Open incidents"
              value={
                data.browserTests.openIncidents > 0 ? (
                  <Link
                    className="hover:underline"
                    to={`/w/${current.id}/incidents?status=open&type=browser`}
                  >
                    {data.browserTests.openIncidents}
                  </Link>
                ) : (
                  0
                )
              }
            />
            <StatRow
              danger={data.browserTests.failed24h > 0}
              label="Failures (24 h)"
              value={data.browserTests.failed24h}
            />
          </div>
          <Link
            className="mt-4 border-t border-zinc-200 pt-3 text-sm font-medium text-accent-700 hover:underline"
            to={`/w/${current.id}/tests`}
          >
            View tests →
          </Link>
        </Card>

        <Card className="flex flex-col" title="Uptime">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["UP", data.uptime.up, "text-ok-700"],
              ["DOWN", data.uptime.down, "text-danger-700"],
              ["UNKNOWN", data.uptime.unknown, "text-zinc-600"],
            ].map(([label, value, className]) => (
              <div key={label} className="rounded-md bg-zinc-50 p-2 text-center">
                <p className={clsx("text-lg font-semibold", className)}>{value}</p>
                <p className="text-[11px] font-medium text-zinc-500">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex-1 space-y-3">
            <StatRow
              danger={data.uptime.openIncidents > 0}
              label="Open incidents"
              value={
                data.uptime.openIncidents > 0 ? (
                  <Link
                    className="hover:underline"
                    to={`/w/${current.id}/incidents?status=open&type=uptime`}
                  >
                    {data.uptime.openIncidents}
                  </Link>
                ) : (
                  0
                )
              }
            />
            <StatRow
              label="Avg response (24 h)"
              value={
                data.uptime.avgResponseTimeMs24h === null
                  ? "—"
                  : `${Math.round(data.uptime.avgResponseTimeMs24h)} ms`
              }
            />
          </div>
          <Link
            className="mt-4 border-t border-zinc-200 pt-3 text-sm font-medium text-accent-700 hover:underline"
            to={`/w/${current.id}/uptime`}
          >
            View monitors →
          </Link>
        </Card>
      </div>

      <Card padding="none" title="Recent activity" className="overflow-hidden [&>div:first-child]:px-4 [&>div:first-child]:pt-4">
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
          <ul className="divide-y divide-zinc-200">
            {data.activity.map((item) => {
              const presentation = activityPresentation[item.type];
              const Icon = presentation.icon;
              return (
                <li key={activityKey(item)}>
                  <Link
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50"
                    to={activityPath(current.id, item)}
                  >
                    <span
                      className={clsx(
                        "grid size-8 shrink-0 place-items-center rounded-full",
                        presentation.className,
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {item.resourceName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {formatRelative(item.occurredAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function browserTestNoun(count: number): "test" | "tests" {
  return count === 1 ? "test" : "tests";
}
