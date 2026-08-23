import type { Analytics, Overview, WorkersResponse } from "../../shared/types";
import { formatNumber, formatSigned, percent } from "./format";
import {
  finishedRuns,
  formatEuros,
  formatPct,
  lastOf,
  mrrBreakdown,
  passRate,
  periodDelta,
  sparkline,
  uptimePct,
} from "./series";
import type { SparkPoint } from "./series";

const UNKNOWN = "—";

export type DeltaTone = "danger" | "neutral" | "ok";

export interface KpiDelta {
  text: string;
  tone: DeltaTone;
}

export interface Kpi {
  /** The bottom band of a tile that has no trend to draw. */
  detail?: string;
  delta?: KpiDelta;
  hint?: string;
  label: string;
  spark?: SparkPoint[];
  /** Set only where the number itself is a verdict — an incident, a dead worker. */
  tone?: "danger";
  value: string;
}

export interface KpiInput {
  analytics?: Analytics;
  overview?: Overview;
  workers?: WorkersResponse;
}

/**
 * The account base, what the week added, and — once the overview answers — how
 * much of that base ever confirmed an email address. Both halves of the panel
 * count users; only the overview knows how many are verified.
 */
function usersKpi(analytics: Analytics | undefined, overview: Overview | undefined): Kpi {
  if (analytics === undefined) return { label: "Users", value: UNKNOWN };
  const week = periodDelta(analytics.users, "signups", 7);
  const trend = week.comparable ? `${formatSigned(week.change)} vs previous 7 d` : undefined;
  return {
    delta: { text: `${formatSigned(week.current)} in 7 d`, tone: week.current > 0 ? "ok" : "neutral" },
    hint:
      overview === undefined
        ? trend
        : `${formatNumber(overview.users.verified)} verified`,
    label: "Users",
    spark: sparkline(analytics.users, "cumulative"),
    value: formatNumber(lastOf(analytics.users)?.cumulative ?? 0),
  };
}

function activeUsersKpi(analytics: Analytics | undefined): Kpi {
  if (analytics === undefined) return { label: "Active users 7 d", value: UNKNOWN };
  return {
    hint: `${formatNumber(analytics.business.activeUsers30d)} in 30 d`,
    label: "Active users 7 d",
    spark: sparkline(analytics.users, "dau"),
    value: formatNumber(analytics.business.activeUsers7d),
  };
}

function workspacesKpi(analytics: Analytics | undefined, overview: Overview | undefined): Kpi {
  const business = analytics?.business;
  return {
    detail:
      business === undefined
        ? undefined
        : `${formatNumber(business.freeWorkspaces)} free · ${formatNumber(business.grantWorkspaces)} grant`,
    label: "Workspaces",
    value: overview === undefined ? UNKNOWN : formatNumber(overview.workspaces.total),
  };
}

function mrrKpi(analytics: Analytics | undefined): Kpi {
  if (analytics === undefined) return { label: "MRR", value: UNKNOWN };
  const { mrrCents, payingWorkspaces } = analytics.business;
  return {
    detail: mrrBreakdown(mrrCents, payingWorkspaces) ?? "No paid subscriptions yet",
    hint: `${formatNumber(payingWorkspaces)} paying`,
    label: "MRR",
    value: formatEuros(mrrCents),
  };
}

/**
 * The runs the day has created, and how the ones that finished went. The value
 * counts everything, QUEUED and RUNNING included; the rate divides by the
 * finished ones only, which is what "pass rate" means everywhere else.
 */
function runsKpi(analytics: Analytics | undefined): Kpi {
  if (analytics === undefined) return { label: "Runs today", value: UNKNOWN };
  const today = lastOf(analytics.runs);
  const finished = today === undefined ? 0 : finishedRuns(today);
  return {
    hint:
      today === undefined || today.total === 0
        ? "No runs yet today"
        : finished === 0
          ? "None have finished yet today"
          : `${percent(passRate(today))} passed so far today`,
    label: "Runs today",
    spark: sparkline(analytics.runs, "total"),
    value: formatNumber(today?.total ?? 0),
  };
}

function checksKpi(analytics: Analytics | undefined): Kpi {
  if (analytics === undefined) return { label: "Checks today", value: UNKNOWN };
  const today = lastOf(analytics.checks);
  const total = today === undefined ? 0 : today.up + today.down;
  return {
    hint:
      today === undefined || total === 0
        ? "No checks yet today"
        : `${formatPct(uptimePct(today))} up so far today`,
    label: "Checks today",
    spark: analytics.checks
      .slice(Math.max(0, analytics.checks.length - 14))
      .map((day) => ({ day: day.day, value: day.up + day.down })),
    value: formatNumber(total),
  };
}

function incidentsKpi(analytics: Analytics | undefined): Kpi {
  if (analytics === undefined) return { label: "Open incidents", value: UNKNOWN };
  const open = analytics.business.openIncidents;
  const week = periodDelta(analytics.incidents, "opened", 7);
  return {
    delta: {
      text: `${formatNumber(week.current)} opened in 7 d`,
      tone: week.current > 0 ? "danger" : "ok",
    },
    hint: week.comparable ? `${formatSigned(week.change)} vs previous 7 d` : undefined,
    label: "Open incidents",
    spark: sparkline(analytics.incidents, "opened"),
    tone: open > 0 ? "danger" : undefined,
    value: formatNumber(open),
  };
}

function workersKpi(workers: WorkersResponse | undefined): Kpi {
  if (workers === undefined) return { label: "Workers online", value: UNKNOWN };
  if ("unavailable" in workers) {
    return { detail: "Pending production migration", label: "Workers online", value: UNKNOWN };
  }
  if (workers.workers.length === 0) {
    return { detail: "No workers have reported yet", label: "Workers online", value: UNKNOWN };
  }
  const online = workers.workers.filter((entry) => entry.online).length;
  const primary = workers.workers.filter((entry) => entry.mode === "local").length;
  return {
    detail: `${formatNumber(primary)} primary · ${formatNumber(workers.workers.length - primary)} fallback`,
    label: "Workers online",
    tone: online < workers.workers.length ? "danger" : undefined,
    value: `${formatNumber(online)} of ${formatNumber(workers.workers.length)}`,
  };
}

/**
 * The eight numbers the panel exists to answer, in a fixed order so the strip
 * never reshuffles under the operator. A tile whose section has not answered yet
 * shows an em dash rather than a zero that would read as bad news.
 */
export function buildKpis({ analytics, overview, workers }: KpiInput): Kpi[] {
  return [
    usersKpi(analytics, overview),
    activeUsersKpi(analytics),
    workspacesKpi(analytics, overview),
    mrrKpi(analytics),
    runsKpi(analytics),
    checksKpi(analytics),
    incidentsKpi(analytics),
    workersKpi(workers),
  ];
}
