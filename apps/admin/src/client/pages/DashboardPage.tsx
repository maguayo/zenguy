import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { Overview } from "../../shared/types";
import { api } from "../api";
import { ActivityFeed } from "../components/ActivityFeed";
import { AlertSpendCard } from "../components/AlertSpendCard";
import { ActiveUsersChart } from "../components/charts/ActiveUsersChart";
import { ChecksChart } from "../components/charts/ChecksChart";
import { DeliveriesChart } from "../components/charts/DeliveriesChart";
import { IncidentsChart } from "../components/charts/IncidentsChart";
import { RunCostChart } from "../components/charts/RunCostChart";
import { RunsChart } from "../components/charts/RunsChart";
import { UsersChart } from "../components/charts/UsersChart";
import { Freshness, oldestUpdate } from "../components/Freshness";
import { KpiStrip } from "../components/KpiStrip";
import { MonitorsCard } from "../components/MonitorsCard";
import { OpenIncidentsCard } from "../components/OpenIncidentsCard";
import { RangeSwitch } from "../components/RangeSwitch";
import { RecentRunsTable } from "../components/RecentRunsTable";
import { Section } from "../components/Section";
import { TestLeaderboard } from "../components/TestLeaderboard";
import { UsersTable } from "../components/UsersTable";
import { WorkersSection } from "../components/WorkersSection";
import { WorkspacesTable } from "../components/WorkspacesTable";
import { parseActivityType, readStoredActivityType, storeActivityType } from "../lib/activity";
import type { ActivityEventType } from "../lib/activity";
import { formatNumber, percent } from "../lib/format";
import { readStoredRange, storeRange } from "../lib/range";
import type { RangeDays } from "../lib/range";
import { fillAnalytics } from "../lib/series";
import type { FilledSeries } from "../lib/series";

const REFETCH_MS = {
  activity: 30_000,
  analytics: 60_000,
  overview: 30_000,
  runs: 30_000,
  users: 60_000,
  workers: 5_000,
  workspaces: 60_000,
};

/**
 * A labelled band of the page. The rule is the label: it says where one subject
 * ends and the next begins without spending a heading's worth of vertical space.
 */
function Row({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-xs font-semibold tracking-[0.08em] text-zinc-400 uppercase">
          {title}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-zinc-200" />
      </div>
      {children}
    </section>
  );
}

/** What the last hour did and what the next 24 h are booked to do. */
function scheduleLine(upcoming: { h1: number; h3: number; h24: number }): string {
  return `Scheduled ${formatNumber(upcoming.h1)} in 1 h · ${formatNumber(upcoming.h3)} in 3 h · ${formatNumber(upcoming.h24)} in 24 h`;
}

function runsFooter(overview: Overview | undefined): string | undefined {
  if (overview === undefined) return undefined;
  const hour = overview.browserRuns.past.h1;
  const recent =
    hour.total === 0
      ? "No runs in the last hour"
      : `Last hour ${formatNumber(hour.total)} runs, ${percent(hour.passRate)} pass`;
  // The scheduled counts only make sense against the tests that produce them.
  return `${recent} · ${scheduleLine(overview.browserRuns.upcoming)} · Active browser tests ${formatNumber(overview.browserTests.active)}`;
}

/** Nothing to plot yet: every section that needs a series is still in `Section`. */
const NO_SERIES: FilledSeries = {
  checks: [],
  deliveries: [],
  incidents: [],
  runs: [],
  users: [],
};

function checksFooter(overview: Overview | undefined): string | undefined {
  if (overview === undefined) return undefined;
  const hour = overview.uptimeChecks.past.h1;
  const recent =
    hour.total === 0
      ? "No checks in the last hour"
      : `Last hour ${formatNumber(hour.total)} checks, ${formatNumber(hour.down)} down`;
  return `${recent} · ${scheduleLine(overview.uptimeChecks.upcoming)}`;
}

export function DashboardPage({ email }: { email: string }) {
  const [range, setRange] = useState<RangeDays>(readStoredRange);
  const [activityType, setActivityType] = useState<ActivityEventType | null>(
    readStoredActivityType,
  );

  const analytics = useQuery({
    // The last answer stays on screen while a new range loads: no skeleton flash,
    // no layout jump, just numbers that catch up.
    placeholderData: (previous) => previous,
    queryFn: () => api.analytics(range),
    queryKey: ["analytics", range],
    refetchInterval: REFETCH_MS.analytics,
  });
  const overview = useQuery({
    queryFn: api.overview,
    queryKey: ["overview"],
    refetchInterval: REFETCH_MS.overview,
  });
  const workers = useQuery({
    queryFn: api.workers,
    queryKey: ["workers"],
    refetchInterval: REFETCH_MS.workers,
  });
  const runs = useQuery({
    queryFn: api.recentRuns,
    queryKey: ["recent-runs"],
    refetchInterval: REFETCH_MS.runs,
  });
  const users = useQuery({
    queryFn: api.users,
    queryKey: ["users"],
    refetchInterval: REFETCH_MS.users,
  });
  const activity = useQuery({
    // Changing the filter changes the key; the previous page of events stays on
    // screen until the filtered one lands, so the card never blinks empty.
    placeholderData: (previous) => previous,
    queryFn: () => api.activity(activityType ?? undefined),
    queryKey: ["activity", activityType],
    refetchInterval: REFETCH_MS.activity,
  });
  const workspaces = useQuery({
    placeholderData: (previous) => previous,
    queryFn: api.workspaces,
    queryKey: ["workspaces"],
    refetchInterval: REFETCH_MS.workspaces,
  });
  // A full reload on sign-out: it drops every cached production number from memory.
  const signOut = useMutation({
    mutationFn: api.logout,
    onSuccess: () => window.location.assign("/login"),
  });

  const now = Date.now();
  const sections = [analytics, overview, workers, runs, users, activity, workspaces];
  // Shaped once per payload, not once per render: the workers query repolls
  // every five seconds and every chart below is memoised on its series.
  const series = useMemo(
    () => (analytics.data === undefined ? NO_SERIES : fillAnalytics(analytics.data)),
    [analytics.data],
  );

  function chooseRange(days: RangeDays) {
    setRange(days);
    storeRange(days);
  }

  // Parsed on the way in as well as on boot: only a type the catalog knows ever
  // reaches the query string, and `?type=` empty is a 400.
  function chooseActivityType(raw: string | null) {
    const type = parseActivityType(raw);
    setActivityType(type);
    storeActivityType(type);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div>
            <h1 className="text-xl font-semibold">Zenguy Admin</h1>
            <p className="text-xs text-zinc-500">
              <Freshness
                stale={sections.some((query) => query.isError)}
                updatedAt={oldestUpdate(sections)}
              />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RangeSwitch onChange={chooseRange} value={range} />
            {signOut.isError ? (
              <span className="text-danger-700">Could not sign out — try again</span>
            ) : null}
            <span className="text-zinc-500">{email}</span>
            <button
              className="h-9 rounded-md border border-zinc-300 bg-white px-3 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              type="button"
            >
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 md:px-6">
        {/* Outside every Section on purpose: three independent queries feed the
            strip, and an analytics outage must not take the workers and
            workspace tiles down with it. A tile with no source shows an em dash
            in the same box, so nothing on the page moves. */}
        <KpiStrip analytics={analytics.data} overview={overview.data} workers={workers.data} />

        <Row title="Growth">
          <Section now={now} query={analytics} subject="growth" title="Growth">
            {() => (
              <div className="grid gap-4 lg:grid-cols-2">
                <UsersChart users={series.users} />
                <ActiveUsersChart users={series.users} />
              </div>
            )}
          </Section>
        </Row>

        <Row title="Browser runs">
          <Section now={now} query={analytics} subject="browser runs" title="Browser runs">
            {() => (
              <div className="grid gap-4 lg:grid-cols-2">
                <RunsChart footer={runsFooter(overview.data)} runs={series.runs} />
                <RunCostChart runs={series.runs} />
              </div>
            )}
          </Section>
        </Row>

        <Row title="Uptime">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section now={now} query={analytics} subject="checks" title="Checks per day">
                {() => (
                  <ChecksChart checks={series.checks} footer={checksFooter(overview.data)} />
                )}
              </Section>
            </div>
            <Section now={now} query={overview} subject="monitors" title="Monitors">
              {(data) => (
                // The badges come from this section; the list comes from
                // analytics, which may not have answered yet. Passing undefined
                // rather than [] is what keeps the card from claiming every
                // monitor is up while a DOWN badge sits above it.
                <MonitorsCard
                  monitors={data.uptimeMonitors}
                  now={now}
                  rows={analytics.data?.monitorsDown}
                />
              )}
            </Section>
          </div>
        </Row>

        <Row title="Incidents & alerts">
          <Section now={now} query={analytics} subject="incidents" title="Incidents & alerts">
            {(data) => (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <IncidentsChart incidents={series.incidents} />
                  </div>
                  <OpenIncidentsCard incidents={data.openIncidents} now={now} />
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <DeliveriesChart deliveries={series.deliveries} />
                  </div>
                  <AlertSpendCard
                    business={data.business}
                    days={data.range.days}
                    deliveries={series.deliveries}
                  />
                </div>
              </div>
            )}
          </Section>
        </Row>

        <Row title="Activity">
          <Section now={now} query={activity} subject="activity" title="Activity">
            {(data) => (
              <ActivityFeed
                feed={data}
                now={now}
                onTypeChange={chooseActivityType}
                type={activityType}
              />
            )}
          </Section>
        </Row>

        <Row title="Workers">
          <Section now={now} query={workers} subject="workers" title="Workers">
            {(data) => <WorkersSection workers={data} />}
          </Section>
        </Row>

        <Row title="Tests & workspaces">
          <div className="space-y-4">
            <Section now={now} query={analytics} subject="leaderboards" title="Tests">
              {(data) => (
                <div className="grid gap-4 lg:grid-cols-2">
                  <TestLeaderboard
                    kind="failing"
                    rows={data.topFailingTests}
                    title="Top failing tests"
                  />
                  <TestLeaderboard kind="slow" rows={data.slowestTests} title="Slowest tests" />
                </div>
              )}
            </Section>
            {/* Its own section: the activity columns come from /api/workspaces
                and the 30-day counters from analytics, so an analytics outage
                must not take the workspace list down with it. */}
            <Section now={now} query={workspaces} subject="workspaces" title="Workspaces">
              {(data) => (
                <WorkspacesTable
                  active={analytics.data?.activeWorkspaces}
                  now={now}
                  workspaces={data}
                />
              )}
            </Section>
          </div>
        </Row>

        <Row title="Latest activity">
          <div className="space-y-4">
            <Section now={now} query={runs} subject="recent runs" title="Recent runs">
              {(data) => <RecentRunsTable now={now} runs={data.runs} />}
            </Section>
            <Section now={now} query={users} subject="users" title="Users">
              {(data) => <UsersTable now={now} users={data.users} />}
            </Section>
          </div>
        </Row>
      </main>
    </div>
  );
}
