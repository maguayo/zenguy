import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api";
import { CostsHero } from "../components/CostsHero";
import { RangeSwitch } from "../components/RangeSwitch";
import { RecentRunsTable } from "../components/RecentRunsTable";
import { Section } from "../components/Section";
import { TestsHero } from "../components/TestsHero";
import { UptimeHero } from "../components/UptimeHero";
import { UsersHero } from "../components/UsersHero";
import { UsersTable } from "../components/UsersTable";
import { WorkersSection } from "../components/WorkersSection";
import { readStoredRange, storeRange } from "../lib/range";
import type { RangeDays } from "../lib/range";
import { relativeSeconds } from "../lib/format";

const REFETCH_MS = { costs: 300_000, metrics: 60_000, runs: 30_000, users: 60_000, workers: 5_000 };

/**
 * How fresh the panel as a whole is: the age of its *oldest* section, counted on
 * its own second so the rest of the dashboard does not re-render every second.
 */
export function Freshness({ stale, updatedAt }: { stale: boolean; updatedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (updatedAt === 0) return <>Production · connecting…</>;
  if (stale) {
    return (
      <>
        {"Production · "}
        <span className="font-medium text-danger-700">
          {`Some sections are stale — oldest data ${relativeSeconds(updatedAt, now)}`}
        </span>
      </>
    );
  }
  return <>{`Production · updated ${relativeSeconds(updatedAt, now)}`}</>;
}

export function DashboardPage({ email }: { email: string }) {
  const [range, setRange] = useState<RangeDays>(readStoredRange);
  const metrics = useQuery({
    queryFn: () => api.metrics(range),
    queryKey: ["metrics", range],
    // Switching ranges keeps the previous window on screen instead of a skeleton.
    placeholderData: (previous) => previous,
    refetchInterval: REFETCH_MS.metrics,
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
  const costs = useQuery({
    queryFn: () => api.costs(range),
    queryKey: ["costs", range],
    placeholderData: (previous) => previous,
    refetchInterval: REFETCH_MS.costs,
  });
  const queryClient = useQueryClient();
  const refreshCosts = useMutation({
    mutationFn: api.refreshCosts,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["costs"] }),
  });
  // A full reload on sign-out: it drops every cached production number from memory.
  const signOut = useMutation({
    mutationFn: api.logout,
    onSuccess: () => window.location.assign("/login"),
  });

  const changeRange = (days: RangeDays) => {
    setRange(days);
    storeRange(days);
  };

  const now = Date.now();
  const sections = [metrics, costs, workers, runs, users];
  const loaded = sections.filter((query) => query.data !== undefined);
  const oldestUpdate =
    loaded.length === 0 ? 0 : Math.min(...loaded.map((query) => query.dataUpdatedAt));

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div>
            <h1 className="text-xl font-semibold">Zenguy Admin</h1>
            <p className="text-xs text-zinc-500">
              <Freshness
                stale={sections.some((query) => query.isError)}
                updatedAt={oldestUpdate}
              />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RangeSwitch onChange={changeRange} value={range} />
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

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <Section now={now} query={metrics} subject="metrics" title="Usuarios">
          {(data) => <UsersHero users={data.users} />}
        </Section>

        <Section now={now} query={metrics} subject="metrics" title="Browser tests">
          {(data) => <TestsHero tests={data.tests} />}
        </Section>

        <Section now={now} query={metrics} subject="metrics" title="Uptime">
          {(data) => <UptimeHero uptime={data.uptime} />}
        </Section>

        <Section now={now} query={costs} subject="costs" title="Costes (Cloudflare)">
          {(data) => (
            <CostsHero
              costs={data}
              now={now}
              onRefresh={() => refreshCosts.mutate()}
              refreshError={
                refreshCosts.isError
                  ? refreshCosts.error instanceof Error
                    ? refreshCosts.error.message
                    : "La recogida ha fallado"
                  : null
              }
              refreshing={refreshCosts.isPending}
            />
          )}
        </Section>

        <Section now={now} query={workers} subject="workers" title="Workers">
          {(data) => <WorkersSection workers={data} />}
        </Section>

        <Section now={now} query={runs} subject="recent runs" title="Recent runs">
          {(data) => <RecentRunsTable now={now} runs={data.runs} />}
        </Section>

        <Section now={now} query={users} subject="users" title="Users">
          {(data) => <UsersTable now={now} users={data.users} />}
        </Section>
      </main>
    </div>
  );
}
