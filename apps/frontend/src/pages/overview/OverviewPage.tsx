import { useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { Link } from "react-router-dom";

import { listIncidents } from "../../api/incidents";
import { getOverview } from "../../api/overview";
import { listTests } from "../../api/tests";
import type {
  ActivityItem,
  ActivityType,
  BrowserTest,
  Incident,
  Monitor,
  MonitorStats,
  RunStatus,
  Usage,
} from "../../api/types";
import { getStats, listMonitors } from "../../api/uptime";
import { Card } from "../../components/ui/Card";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { formatCurrency, formatDateTime, formatDuration } from "../../lib/format";
import { OverviewHero } from "./OverviewHero";

interface ActivityPresentation {
  className: string;
  label: string;
}

export const activityPresentation: Record<ActivityType, ActivityPresentation> = {
  TEST_PASSED: { className: "bg-[#169941]", label: "Passed" },
  TEST_FAILED: { className: "bg-red-500", label: "Failed" },
  TEST_TIMEOUT: { className: "bg-amber-500", label: "Timeout" },
  TEST_SYSTEM_ERROR: { className: "bg-zinc-500", label: "System error" },
  TEST_RECOVERED: { className: "bg-[#169941]", label: "Recuperado" },
  MONITOR_DOWN: { className: "bg-red-500", label: "Incidente abierto" },
  MONITOR_RECOVERED: { className: "bg-[#169941]", label: "Recuperado" },
  CHANNEL_DELIVERY_FAILED: { className: "bg-amber-500", label: "Entrega fallida" },
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

export function browserTestNoun(count: number): "test" | "tests" {
  return count === 1 ? "test" : "tests";
}

export function safeHost(value: string): string {
  try {
    return new URL(value).host || "Unknown host";
  } catch {
    return "Unknown host";
  }
}

export function compactTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "—";
  const difference = timestamp - Date.now();
  const future = difference > 0;
  const elapsed = Math.abs(difference);
  if (elapsed < 60_000) return "ahora";
  const value =
    elapsed < 3_600_000
      ? `${Math.max(1, Math.round(elapsed / 60_000))}m`
      : elapsed < 86_400_000
        ? `${Math.max(1, Math.round(elapsed / 3_600_000))}h`
        : `${Math.max(1, Math.round(elapsed / 86_400_000))}d`;
  return future ? `en ${value}` : value;
}

export function responsePercentile(values: number[], percentile = 0.95): number | null {
  const measured = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (measured.length === 0) return null;
  const index = Math.max(0, Math.ceil(measured.length * percentile) - 1);
  return measured[Math.min(index, measured.length - 1)] ?? null;
}

export function usageSegmentCount(
  used: number,
  included: number,
  segments = 30,
): number {
  if (!Number.isFinite(used) || !Number.isFinite(included) || included <= 0 || segments <= 0) {
    return 0;
  }
  return Math.min(segments, Math.max(0, Math.round((used / included) * segments)));
}

function heroIncident(page: { items: Incident[] } | undefined): Incident | null | undefined {
  return page === undefined ? undefined : (page.items[0] ?? null);
}

function frequencyLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3_600;
  return hours === 1 ? "1 h" : `${hours} h`;
}

function intervalLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  return hours === 1 ? "cada hora" : `cada ${hours} h`;
}

function decimalPercent(value: number): string {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

function SectionHeader({
  count,
  linkLabel,
  title,
  to,
}: {
  count: number;
  linkLabel: string;
  title: string;
  to: string;
}) {
  return (
    <div className="flex h-[41px] items-center justify-between gap-4 px-[22px] 2xl:h-[51px] 2xl:gap-5 2xl:px-[27.5px]">
      <h2 className="text-sm font-semibold tracking-[-0.015em] text-zinc-950 2xl:text-[17.5px] 2xl:leading-[25px]">
        {title}<span className="font-normal text-zinc-400"> · {count}</span>
      </h2>
      <Link className="text-xs font-semibold text-[#463de1] hover:underline 2xl:text-[15px] 2xl:leading-5" to={to}>
        {linkLabel} →
      </Link>
    </div>
  );
}

function MonitorBars({ monitor, stats }: { monitor: Monitor; stats?: MonitorStats }) {
  const measured = (stats?.series ?? []).slice(-24);
  const recent = measured.length > 0
    ? measured.map((point, index) => ({
        id: `${point.t}:${index}`,
        response: point.responseTimeMs,
        status: point.status,
      }))
    : (monitor.recentChecks ?? []).slice(-24).map((check, index) => ({
        id: check.id,
        response: null,
        status: check.status,
        index,
      }));
  const placeholders = Math.max(0, 24 - recent.length);
  const max = Math.max(1, ...recent.map((point) => point.response ?? 0));

  return (
    <div
      aria-label={`Historial reciente de ${monitor.name}`}
      className="flex h-6 min-w-0 items-end gap-[2px] 2xl:h-[30px] 2xl:gap-[2.5px]"
      role="img"
    >
      {Array.from({ length: placeholders }, (_, index) => (
        <span key={`empty-${index}`} className="h-1.5 min-w-[3px] flex-1 bg-indigo-50 2xl:h-[7.5px] 2xl:min-w-[3.75px]" />
      ))}
      {recent.map((point, index) => (
        <span
          key={point.id}
          className={clsx(
            "min-w-[3px] flex-1 rounded-[1px] 2xl:min-w-[3.75px] 2xl:rounded-[1.25px]",
            point.status === "FAILED" ? "bg-red-300" : "bg-indigo-200",
          )}
          style={{
            height: point.response === null
              ? `${32 + ((index * 17) % 44)}%`
              : `${Math.max(28, Math.round((point.response / max) * 100))}%`,
          }}
        />
      ))}
    </div>
  );
}

function MonitorRow({
  monitor,
  stats,
  workspaceId,
}: {
  monitor: Monitor;
  stats?: MonitorStats;
  workspaceId: string;
}) {
  const uptime = stats?.uptime30d;
  const response = stats?.avgResponseTimeMs24h ?? monitor.lastResponseTimeMs;
  return (
    <Link
      className="group grid min-h-[61px] grid-cols-[10px_minmax(0,1fr)_82px_12px] items-center gap-3 border-t border-[#f0efed] px-[22px] transition-colors hover:bg-zinc-50/70 min-[1100px]:grid-cols-[10px_minmax(130px,1.2fr)_minmax(100px,.8fr)_90px_80px_minmax(12px,1fr)] min-[1400px]:grid-cols-[10px_213px_154px_110px_104px_minmax(12px,1fr)] 2xl:min-h-[76px] 2xl:grid-cols-[12.5px_minmax(170px,1.2fr)_minmax(120px,.8fr)_110px_104px_minmax(15px,1fr)] 2xl:gap-[15px] 2xl:px-[27.5px]"
      to={`/w/${workspaceId}/uptime/${monitor.id}`}
    >
      <span
        aria-label={monitor.status === "UP" ? "Up" : monitor.status === "DOWN" ? "Down" : "Unknown"}
        className={clsx(
          "size-2 rounded-full 2xl:size-2.5",
          monitor.status === "UP" && "bg-[#169941]",
          monitor.status === "DOWN" && "bg-red-500",
          monitor.status === "UNKNOWN" && "bg-zinc-400",
        )}
        role="img"
      />
      <span className="min-w-0">
        <strong className="block truncate text-[13px] font-semibold leading-4 text-zinc-900 2xl:text-[16.25px] 2xl:leading-5">
          {monitor.name}
        </strong>
        <span className="mt-0.5 block truncate text-[11px] leading-4 text-zinc-500 2xl:mt-[2.5px] 2xl:text-[13.75px] 2xl:leading-5">
          {monitor.method} · cada {frequencyLabel(monitor.frequencySeconds)}
        </span>
      </span>
      <span className="hidden min-w-0 min-[1100px]:block">
        <MonitorBars monitor={monitor} stats={stats} />
      </span>
      <span className="hidden min-w-0 font-mono text-[13px] tabular-nums text-zinc-900 min-[1100px]:block 2xl:text-[16.25px] 2xl:leading-5">
        {response === null || response === undefined ? "—" : `${Math.round(response)} ms`}
        <span className="mt-0.5 block font-sans text-[10px] text-zinc-400 2xl:mt-[2.5px] 2xl:text-[12.5px] 2xl:leading-[17.5px]">resp. media</span>
      </span>
      <span className="pl-3 text-left font-mono text-[13px] tabular-nums text-emerald-600 2xl:pl-[15px] 2xl:text-[16.25px] 2xl:leading-5">
        {uptime === null || uptime === undefined ? "—" : `${decimalPercent(uptime)} %`}
        <span className="mt-0.5 block font-sans text-[10px] text-zinc-400 2xl:mt-[2.5px] 2xl:text-[12.5px] 2xl:leading-[17.5px]">uptime 30 d</span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-3 justify-self-end text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500 2xl:size-[15px]"
      />
    </Link>
  );
}

const RUN_TONE: Record<RunStatus, string> = {
  FAILED: "bg-red-400",
  PASSED: "bg-[#7beda2]",
  QUEUED: "bg-indigo-300",
  RUNNING: "bg-indigo-400",
  SYSTEM_ERROR: "bg-zinc-300",
  TIMEOUT: "bg-amber-400",
};

function TestBars({ test }: { test: BrowserTest }) {
  const runs = (test.recentRuns ?? []).slice(-20);
  const placeholders = Math.max(0, 20 - runs.length);
  return (
    <div className="flex h-6 items-end gap-[2px] 2xl:h-[30px] 2xl:gap-[2.5px]" aria-label={`Últimos runs de ${test.name}`} role="img">
      {Array.from({ length: placeholders }, (_, index) => (
        <span key={`empty-${index}`} className="h-2 min-w-[4px] flex-1 bg-zinc-100 2xl:h-2.5 2xl:min-w-[5px]" />
      ))}
      {runs.map((run, index) => (
        <span
          key={run.id}
          className={clsx("min-w-[4px] flex-1 rounded-[1px] 2xl:min-w-[5px] 2xl:rounded-[1.25px]", RUN_TONE[run.status])}
          style={{ height: `${run.status === "RUNNING" || run.status === "QUEUED" ? 100 : 38 + ((index * 19) % 30)}%` }}
          title={run.status.toLowerCase().replace("_", " ")}
        />
      ))}
    </div>
  );
}

function testStatus(test: BrowserTest): RunStatus | null {
  return test.recentRuns?.at(-1)?.status ?? test.lastRun?.status ?? null;
}

function statusLabel(status: RunStatus | null): { label: string; tone: string } {
  if (status === "PASSED") return { label: "Passed", tone: "bg-[#d7fce3] text-[#147d37]" };
  if (status === "FAILED") return { label: "Failed", tone: "bg-red-100 text-red-700" };
  if (status === "TIMEOUT") return { label: "Timeout", tone: "bg-amber-100 text-amber-700" };
  if (status === "RUNNING") return { label: "Running", tone: "bg-indigo-100 text-indigo-700" };
  if (status === "QUEUED") return { label: "Queued", tone: "bg-indigo-100 text-indigo-700" };
  if (status === "SYSTEM_ERROR") return { label: "System error", tone: "bg-zinc-100 text-zinc-700" };
  return { label: "Sin runs", tone: "bg-zinc-100 text-zinc-600" };
}

function BrowserTestRow({ test, workspaceId }: { test: BrowserTest; workspaceId: string }) {
  const status = testStatus(test);
  const badge = statusLabel(status);
  const completed = (test.recentRuns ?? []).filter((run) =>
    ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"].includes(run.status),
  );
  const passed = completed.filter((run) => run.status === "PASSED").length;
  return (
    <Link
      className="group grid min-h-[88px] grid-cols-[74px_minmax(0,1fr)_86px_12px] items-center gap-3 border-t border-[#f0efed] px-[22px] transition-colors hover:bg-zinc-50/70 min-[1100px]:grid-cols-[74px_minmax(120px,1.15fr)_minmax(100px,.85fr)_92px_76px_minmax(12px,1fr)] min-[1400px]:grid-cols-[74px_149px_154px_102px_88px_minmax(12px,1fr)] 2xl:min-h-[110px] 2xl:grid-cols-[92.5px_minmax(160px,1.15fr)_minmax(130px,.85fr)_105px_95px_minmax(15px,1fr)] 2xl:gap-[15px] 2xl:px-[27.5px]"
      to={`/w/${workspaceId}/tests/${test.id}`}
    >
      <span className={clsx("inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold 2xl:gap-[5px] 2xl:px-[12.5px] 2xl:py-[5px] 2xl:text-[13.75px] 2xl:leading-5", badge.tone)}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current 2xl:size-[7.5px]" />
        {badge.label}
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-[13px] font-semibold leading-4 text-zinc-900 2xl:text-[16.25px] 2xl:leading-5">{test.name}</strong>
        <span className="mt-0.5 block truncate text-[11px] leading-4 text-zinc-500 2xl:mt-[2.5px] 2xl:text-[13.75px] 2xl:leading-5">
          {safeHost(test.startUrl)} · {test.device === "DESKTOP" ? "Desktop" : "Mobile"} ·
        </span>
        <span className="block truncate text-[11px] leading-4 text-zinc-500 2xl:text-[13.75px] 2xl:leading-5">
          {intervalLabel(test.intervalHours)} · próximo {compactTime(test.nextRunAt)}
        </span>
      </span>
      <span className="hidden min-w-0 min-[1100px]:block"><TestBars test={test} /></span>
      <span className="hidden font-mono text-[13px] tabular-nums text-zinc-900 min-[1100px]:block 2xl:text-[16.25px] 2xl:leading-5">
        {test.lastRun?.durationMs == null ? "—" : formatDuration(test.lastRun.durationMs).replace(/([hms])/g, "$1 ").trim()}
        <span className="mt-0.5 block font-sans text-[10px] text-zinc-400 2xl:mt-[2.5px] 2xl:text-[12.5px] 2xl:leading-[17.5px]">último run</span>
      </span>
      <span className="text-center font-mono text-[13px] tabular-nums text-emerald-600 2xl:text-[16.25px] 2xl:leading-5">
        {completed.length === 0 ? "—" : `${passed}/${completed.length}`}
        <span className="mt-0.5 block font-sans text-[10px] text-zinc-400 2xl:mt-[2.5px] 2xl:text-[12.5px] 2xl:leading-[17.5px]">últimos runs</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-3 justify-self-end text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500 2xl:size-[15px]" />
    </Link>
  );
}

function CompactInventoryState({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[82px] flex-1 place-items-center border-t border-[#f0efed] px-5 text-xs text-zinc-500 2xl:min-h-[102.5px] 2xl:px-[25px] 2xl:text-[15px] 2xl:leading-5">{children}</div>;
}

function InventoryError({ onRetry }: { onRetry: () => void }) {
  return (
    <CompactInventoryState>
      <span className="flex items-center gap-2 2xl:gap-2.5">
        No se pudo cargar el inventario.
        <button className="font-semibold text-[#463de1] hover:underline" type="button" onClick={onRetry}>
          Reintentar
        </button>
      </span>
    </CompactInventoryState>
  );
}

function MonitorsCard({
  count,
  error,
  monitors,
  onRetry,
  pending,
  statsById,
  workspaceId,
}: {
  count: number;
  error: boolean;
  monitors: Monitor[];
  onRetry: () => void;
  pending: boolean;
  statsById: Map<string, MonitorStats>;
  workspaceId: string;
}) {
  return (
    <Card className="flex min-h-[178px] flex-col overflow-hidden rounded-xl border-[#e9e9e7] 2xl:min-h-[223px] 2xl:rounded-[15px]" padding="none">
      <SectionHeader count={count} linkLabel="Ver monitores" title="Monitores" to={`/w/${workspaceId}/uptime`} />
      {error ? (
        <InventoryError onRetry={onRetry} />
      ) : pending ? (
        <div className="flex-1 space-y-3 border-t border-[#f0efed] px-[22px] py-4 2xl:space-y-[15px] 2xl:px-[27.5px] 2xl:py-5">
          <Skeleton className="h-9 w-full 2xl:h-[45px]" /><Skeleton className="h-9 w-full 2xl:h-[45px]" />
        </div>
      ) : monitors.length === 0 ? (
        <CompactInventoryState>No hay monitores todavía.</CompactInventoryState>
      ) : monitors.slice(0, 2).map((monitor) => (
        <MonitorRow key={monitor.id} monitor={monitor} stats={statsById.get(monitor.id)} workspaceId={workspaceId} />
      ))}
    </Card>
  );
}

function TestsCard({ count, error, onRetry, pending, tests, workspaceId }: { count: number; error: boolean; onRetry: () => void; pending: boolean; tests: BrowserTest[]; workspaceId: string }) {
  return (
    <Card className="flex min-h-[131px] flex-col overflow-hidden rounded-xl border-[#e9e9e7] 2xl:min-h-[164px] 2xl:rounded-[15px]" padding="none">
      <SectionHeader count={count} linkLabel="Ver tests" title="Browser tests" to={`/w/${workspaceId}/tests`} />
      {error ? (
        <InventoryError onRetry={onRetry} />
      ) : pending ? (
        <div className="flex-1 border-t border-[#f0efed] px-[22px] py-5 2xl:px-[27.5px] 2xl:py-[25px]"><Skeleton className="h-10 w-full 2xl:h-[50px]" /></div>
      ) : tests.length === 0 ? (
        <CompactInventoryState>No hay browser tests todavía.</CompactInventoryState>
      ) : (
        <BrowserTestRow test={tests[0]!} workspaceId={workspaceId} />
      )}
    </Card>
  );
}

function responseValues(stats: MonitorStats[]): number[] {
  return stats
    .flatMap((entry) => entry.series)
    .filter((point) => point.responseTimeMs !== null)
    .sort((left, right) => Date.parse(left.t) - Date.parse(right.t))
    .map((point) => point.responseTimeMs as number);
}

function sampledValues(measured: number[]): number[] {
  if (measured.length <= 48) return measured;
  return Array.from({ length: 48 }, (_, index) => measured[Math.floor((index / 47) * (measured.length - 1))]!);
}

function ResponseTimeCard({ fallbackAverage, pending, stats }: { fallbackAverage: number | null; pending: boolean; stats: MonitorStats[] }) {
  const measured = responseValues(stats);
  const average = measured.length > 0
    ? measured.reduce((sum, value) => sum + value, 0) / measured.length
    : fallbackAverage;
  const values = sampledValues(measured);
  const max = Math.max(1, ...values);
  const p95 = responsePercentile(measured);
  return (
    <Card className="h-auto min-h-[176px] overflow-hidden rounded-xl border-[#e9e9e7] px-[22px] pb-4 pt-[17px] sm:h-[154px] sm:min-h-0 2xl:h-[193px] 2xl:rounded-[15px] 2xl:px-[27.5px] 2xl:pb-5 2xl:pt-[21.25px]" padding="none">
      <div className="flex items-baseline justify-between gap-4 2xl:gap-5">
        <h2 className="text-sm font-semibold tracking-[-0.015em] text-zinc-950 2xl:text-[17.5px] 2xl:leading-[25px]">Tiempo de respuesta · 24 h</h2>
        <p className="shrink-0 text-[11px] text-zinc-500 2xl:text-[13.75px] 2xl:leading-5">
          <span className="font-mono text-zinc-900">{average === null ? "—" : `${Math.round(average)} ms`}</span> media
          <span aria-hidden="true"> · </span>
          <span className="font-mono text-zinc-900">{p95 === null ? "—" : `${Math.round(p95)} ms`}</span> p95
        </p>
      </div>
      <div aria-label="Respuesta de las últimas 24 horas" className="mt-4 flex h-[58px] items-end gap-[3px] 2xl:mt-5 2xl:h-[72.5px] 2xl:gap-[3.75px]" role="img">
        {values.length === 0 ? (
          <div className="grid h-full w-full place-items-center text-xs text-zinc-400 2xl:text-[15px] 2xl:leading-5">
            {pending ? "Cargando mediciones" : "Sin serie disponible"}
          </div>
        ) : values.map((value, index) => (
          <span
            key={index}
            className="min-w-[5px] flex-1 rounded-t-[2px] bg-[#98a0f9] 2xl:min-w-[6.25px] 2xl:rounded-t-[2.5px]"
            style={{ height: `${Math.max(22, Math.round((value / max) * 100))}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-400 2xl:mt-2.5 2xl:text-[12.5px] 2xl:leading-[17.5px]"><span>hace 24 h</span><span>ahora</span></div>
    </Card>
  );
}

function shortCycleDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: timezone }).format(date).replace(".", "");
}

function UsageCard({ timezone, usage }: { timezone: string; usage: Usage }) {
  const percentage = usage.includedRuns > 0
    ? Math.min(100, Math.max(0, (usage.billableRuns / usage.includedRuns) * 100))
    : 0;
  const segments = 30;
  const filledSegments = usageSegmentCount(usage.billableRuns, usage.includedRuns, segments);
  return (
    <Card className="h-[185px] rounded-xl border-[#e9e9e7] px-5 pb-4 pt-[18px] 2xl:h-[231px] 2xl:rounded-[15px] 2xl:px-[25px] 2xl:pb-5 2xl:pt-[22.5px]" padding="none">
      <div className="flex items-center justify-between gap-4 2xl:gap-5">
        <h2 className="text-sm font-semibold tracking-[-0.015em] text-zinc-950 2xl:text-[17.5px] 2xl:leading-[25px]">Consumo del ciclo</h2>
        <span className="text-[11px] text-zinc-400 2xl:text-[13.75px] 2xl:leading-5">renueva {shortCycleDate(usage.periodEnd, timezone)}</span>
      </div>
      <p className="mt-3 flex items-baseline gap-1.5 tabular-nums 2xl:mt-[15px] 2xl:gap-[7.5px]">
        <strong className="text-[26px] font-semibold leading-7 tracking-[-0.05em] text-zinc-950 2xl:text-[32.5px] 2xl:leading-[35px]">{usage.billableRuns}</strong>
        <span className="text-[13px] text-zinc-500 2xl:text-[16.25px] 2xl:leading-5">de {usage.includedRuns} runs · {formatCurrency(usage.projectedTotalCents, usage.currency)} previstos</span>
      </p>
      <div aria-label={`${usage.billableRuns} de ${usage.includedRuns} runs consumidos`} className="mt-3 h-2 overflow-hidden rounded-full bg-[#eeedea] 2xl:mt-[15px] 2xl:h-2.5" role="progressbar" aria-valuemax={usage.includedRuns} aria-valuemin={0} aria-valuenow={Math.min(usage.billableRuns, usage.includedRuns)}>
        <span className="block h-full rounded-full bg-[linear-gradient(90deg,#463de1,#7681f7)]" style={{ width: `${percentage}%` }} />
      </div>
      <div aria-hidden="true" className="mt-5 flex h-[27px] items-end gap-[3px] 2xl:mt-[25px] 2xl:h-[33.75px] 2xl:gap-[3.75px]">
        {Array.from({ length: segments }, (_, index) => (
          <span
            key={index}
            className={clsx("h-full min-w-[3px] flex-1 2xl:min-w-[3.75px]", index < filledSegments ? "bg-[#dbe3ff]" : "bg-zinc-100")}
          />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-zinc-400 2xl:mt-[5px] 2xl:text-[12.5px] 2xl:leading-[17.5px]">{Math.round(percentage)} % consumido · ciclo actual</p>
    </Card>
  );
}

function ActivityCard({ activity, timezone, workspaceId }: { activity: ActivityItem[]; timezone: string; workspaceId: string }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? activity : activity.slice(0, 7);
  return (
    <Card className="flex min-h-[447px] flex-col overflow-hidden rounded-xl border-[#e9e9e7] 2xl:min-h-[559px] 2xl:rounded-[15px]" padding="none">
      <div className="flex h-[50px] items-center justify-between px-5 2xl:h-[62.5px] 2xl:px-[25px]">
        <h2 className="text-sm font-semibold tracking-[-0.015em] text-zinc-950 2xl:text-[17.5px] 2xl:leading-[25px]">Actividad</h2>
        {activity.length > 7 ? (
          <button
            aria-controls="overview-activity-list"
            aria-expanded={showAll}
            className="text-xs font-semibold text-[#463de1] hover:underline 2xl:text-[15px] 2xl:leading-5"
            type="button"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "Ver menos" : "Ver todo"}
          </button>
        ) : null}
      </div>
      {activity.length === 0 ? (
        <div className="grid min-h-[370px] flex-1 place-items-center px-6 text-center text-xs text-zinc-400 2xl:min-h-[462.5px] 2xl:px-[30px] 2xl:text-[15px] 2xl:leading-5">La actividad aparecerá aquí.</div>
      ) : (
        <ul className="flex-1 px-5 2xl:px-[25px]" id="overview-activity-list">
          {visible.map((item) => {
            const presentation = activityPresentation[item.type];
            const relative = compactTime(item.occurredAt);
            return (
              <li key={activityKey(item)} className="border-b border-[#f0efed] last:border-b-0">
                <Link
                  aria-label={`${item.resourceName}: ${presentation.label}, ${relative}`}
                  className="group grid min-h-[55px] grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-3 py-2.5 transition-colors hover:bg-zinc-50/60 2xl:min-h-[68.75px] 2xl:grid-cols-[10px_minmax(0,1fr)_auto] 2xl:gap-[15px] 2xl:py-[12.5px]"
                  to={activityPath(workspaceId, item)}
                >
                  <span aria-hidden="true" className={clsx("mt-1.5 size-2 rounded-full 2xl:mt-[7.5px] 2xl:size-2.5", presentation.className)} />
                  <span className="min-w-0">
                    <strong className="block truncate text-[13px] font-semibold leading-4 text-zinc-900 group-hover:text-[#463de1] 2xl:text-[16.25px] 2xl:leading-5">{item.resourceName}</strong>
                    <span className="block truncate text-xs leading-4 text-zinc-500 2xl:text-[15px] 2xl:leading-5">{presentation.label}</span>
                  </span>
                  <time className="pt-0.5 text-[11px] text-zinc-400 2xl:pt-[2.5px] 2xl:text-[13.75px] 2xl:leading-5" dateTime={item.occurredAt} title={formatDateTime(item.occurredAt, timezone)}>{relative}</time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-label="Loading overview" className="grid gap-4 2xl:gap-5 min-[1600px]:grid-cols-[minmax(0,1fr)_clamp(400px,25vw,450px)]" role="status">
      <div className="space-y-4 2xl:space-y-5"><Skeleton className="h-[116px] rounded-xl 2xl:h-[145px] 2xl:rounded-[15px]" /><Skeleton className="h-[178px] rounded-xl 2xl:h-[223px] 2xl:rounded-[15px]" /><Skeleton className="h-[131px] rounded-xl 2xl:h-[164px] 2xl:rounded-[15px]" /><Skeleton className="h-[154px] rounded-xl 2xl:h-[193px] 2xl:rounded-[15px]" /></div>
      <div className="space-y-4 2xl:space-y-5"><Skeleton className="h-[185px] rounded-xl 2xl:h-[231px] 2xl:rounded-[15px]" /><Skeleton className="h-[447px] rounded-xl 2xl:h-[559px] 2xl:rounded-[15px]" /></div>
    </div>
  );
}

export default function OverviewPage() {
  const { can, current, timezone } = useWorkspace();
  const overview = useQuery({ queryFn: () => getOverview(current.id), queryKey: ["ws", current.id, "overview"], refetchInterval: 30_000 });
  const monitors = useQuery({ queryFn: () => listMonitors(current.id), queryKey: ["ws", current.id, "monitors"], refetchInterval: 30_000 });
  const tests = useQuery({ queryFn: () => listTests(current.id), queryKey: ["ws", current.id, "tests"], refetchInterval: 30_000 });
  const monitorsForStats = (monitors.data ?? []).slice(0, 2);
  const monitorStats = useQueries({
    queries: monitorsForStats.map((monitor) => ({
      queryFn: () => getStats(current.id, monitor.id),
      queryKey: ["ws", current.id, "monitors", monitor.id, "stats"],
      refetchInterval: 30_000,
      staleTime: 20_000,
    })),
  });
  const openIncidents = overview.data ? overview.data.browserTests.openIncidents + overview.data.uptime.openIncidents : 0;
  const watchedChecks = overview.data ? overview.data.browserTests.total + overview.data.uptime.up + overview.data.uptime.down + overview.data.uptime.unknown : 0;
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

  const statsById = new Map<string, MonitorStats>();
  monitorStats.forEach((query, index) => {
    const monitor = monitorsForStats[index];
    if (monitor && query.data) statsById.set(monitor.id, query.data);
  });
  const statsPending = monitors.isPending || monitorStats.some((query) => query.isPending);
  const completeStats = monitorStats.length === monitorsForStats.length && monitorStats.every((query) => query.isSuccess)
    ? monitorStats.flatMap((query) => query.data ? [query.data] : [])
    : [];
  const monitorCount = overview.data.uptime.up + overview.data.uptime.down + overview.data.uptime.unknown;

  return (
    <div className="grid items-start gap-4 2xl:gap-5 min-[1600px]:grid-cols-[minmax(0,1fr)_clamp(400px,25vw,450px)]">
      <div className="min-w-0 space-y-4 2xl:space-y-5">
        <OverviewHero canManageTests={can("tests.manage")} lastIncident={heroIncident(lastIncidentQuery.data)} openIncident={heroIncident(openIncidentQuery.data)} overview={overview.data} workspaceId={current.id} />
        <MonitorsCard count={monitorCount} error={monitors.isError} monitors={monitors.data ?? []} onRetry={() => void monitors.refetch()} pending={monitors.isPending} statsById={statsById} workspaceId={current.id} />
        <TestsCard count={overview.data.browserTests.total} error={tests.isError} onRetry={() => void tests.refetch()} pending={tests.isPending} tests={tests.data ?? []} workspaceId={current.id} />
        <ResponseTimeCard fallbackAverage={overview.data.uptime.avgResponseTimeMs24h} pending={statsPending} stats={completeStats} />
      </div>
      <div className="min-w-0 space-y-4 2xl:space-y-5">
        <UsageCard timezone={timezone} usage={overview.data.usage} />
        <ActivityCard activity={overview.data.activity} timezone={timezone} workspaceId={current.id} />
      </div>
    </div>
  );
}
