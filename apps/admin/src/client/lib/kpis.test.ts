import { describe, expect, it } from "vitest";

import type {
  Analytics,
  ChecksDay,
  IncidentsDay,
  Overview,
  RunsDay,
  UsersDay,
  WorkerSummary,
} from "../../shared/types";
import { buildKpis } from "./kpis";

const DAYS = Array.from({ length: 14 }, (_, index) => `2026-08-${String(index + 10).padStart(2, "0")}`);

const users: UsersDay[] = DAYS.map((day, index) => ({
  cumulative: 113 + Math.max(0, index - 6),
  dau: index,
  day,
  signups: index < 7 ? 0 : 1,
  wau: null,
}));

const runs: RunsDay[] = DAYS.map((day, index) => ({
  avgDurationMs: 12_000,
  day,
  failed: index === 13 ? 2 : 0,
  fallback: 0,
  inputTokens: 900,
  outputTokens: 100,
  passed: index === 13 ? 8 : 1,
  systemError: 0,
  timeout: 0,
  total: index === 13 ? 10 : 1,
}));

const checks: ChecksDay[] = DAYS.map((day, index) => ({
  avgResponseMs: 210,
  day,
  down: index === 13 ? 1 : 0,
  up: index === 13 ? 59 : 10,
}));

const incidents: IncidentsDay[] = DAYS.map((day, index) => ({
  day,
  opened: index === 3 ? 1 : index >= 10 ? 1 : 0,
  resolved: 0,
}));

const analytics: Analytics = {
  activeWorkspaces: [],
  business: {
    activeUsers30d: 88,
    activeUsers7d: 42,
    creditTopupsCents30d: 5_000,
    freeWorkspaces: 12,
    grantWorkspaces: 2,
    mrrCents: 117_000,
    openIncidents: 2,
    payingWorkspaces: 30,
  },
  checks,
  deliveries: [],
  incidents,
  monitorsDown: [],
  openIncidents: [],
  range: { days: 14, from: DAYS[0] as string, now: 1_800_000_000_000, to: DAYS[13] as string },
  runs,
  slowestTests: [],
  topFailingTests: [],
  users,
};

const overview = {
  browserRuns: { past: {}, upcoming: {} },
  browserTests: { active: 7 },
  uptimeChecks: { past: {}, upcoming: {} },
  uptimeMonitors: { down: 1, total: 5, unknown: 1, up: 3 },
  users: { newLast7d: 7, total: 120, verified: 100 },
  workspaces: { total: 44 },
} as unknown as Overview;

const worker = (id: string, mode: WorkerSummary["mode"], online: boolean): WorkerSummary => ({
  currentAttempt: null,
  firstSeenAt: 0,
  id,
  lastSeenAt: 0,
  mode,
  online,
  runs24h: 4,
  runs7d: 20,
  startedAt: 0,
  tokens24h: 12_400,
  version: "1.4.2",
});

function byLabel(label: string) {
  const tile = buildKpis({
    analytics,
    overview,
    workers: { now: 0, workers: [worker("mac", "local", true), worker("vps", "fallback", false)] },
  }).find((kpi) => kpi.label === label);
  if (tile === undefined) throw new Error(`no tile labelled ${label}`);
  return tile;
}

describe("kpi strip", () => {
  it("leads with the eight numbers the panel is answering", () => {
    expect(buildKpis({}).map((kpi) => kpi.label)).toEqual([
      "Users",
      "Active users 7 d",
      "Workspaces",
      "MRR",
      "Runs today",
      "Checks today",
      "Open incidents",
      "Workers online",
    ]);
  });

  it("counts the account base and what the week added to it", () => {
    const tile = byLabel("Users");
    expect(tile.value).toBe("120");
    expect(tile.delta).toEqual({ text: "+7 in 7 d", tone: "ok" });
    expect(tile.hint).toBe("100 verified");
    expect(tile.spark).toHaveLength(14);
  });

  it("falls back to the week over week trend until the overview answers", () => {
    const tile = buildKpis({ analytics }).find((kpi) => kpi.label === "Users");
    expect(tile?.hint).toBe("+7 vs previous 7 d");
  });

  it("puts the seven day actives against the thirty day ones", () => {
    const tile = byLabel("Active users 7 d");
    expect(tile.value).toBe("42");
    expect(tile.hint).toBe("88 in 30 d");
  });

  it("breaks the workspace count into how those workspaces pay", () => {
    expect(byLabel("Workspaces")).toMatchObject({ detail: "12 free · 2 grant", value: "44" });
  });

  it("shows the arithmetic behind the MRR estimate", () => {
    expect(byLabel("MRR")).toMatchObject({
      detail: "€39 × 30",
      hint: "30 paying",
      value: "€1,170",
    });
  });

  it("says today's runs and checks are still in progress", () => {
    expect(byLabel("Runs today")).toMatchObject({ hint: "80% passed so far today", value: "10" });
    expect(byLabel("Checks today")).toMatchObject({ hint: "98% up so far today", value: "60" });
  });

  it("rates today's runs over the ones that finished, not the ones queued", () => {
    // Ten runs created, five finished, four of those passed: 80 %, not 40 %.
    const queued = buildKpis({
      analytics: {
        ...analytics,
        runs: runs.map((day, index) =>
          index === 13 ? { ...day, failed: 1, passed: 4, total: 10 } : day,
        ),
      },
    }).find((kpi) => kpi.label === "Runs today");
    expect(queued).toMatchObject({ hint: "80% passed so far today", value: "10" });
  });

  it("claims no rate at all while today's runs are all still in flight", () => {
    const inFlight = buildKpis({
      analytics: {
        ...analytics,
        runs: runs.map((day, index) =>
          index === 13 ? { ...day, failed: 0, passed: 0, total: 3 } : day,
        ),
      },
    }).find((kpi) => kpi.label === "Runs today");
    expect(inFlight).toMatchObject({ hint: "None have finished yet today", value: "3" });
  });

  it("marks open incidents as the one number that should be zero", () => {
    const tile = byLabel("Open incidents");
    expect(tile.value).toBe("2");
    expect(tile.tone).toBe("danger");
    expect(tile.delta).toEqual({ text: "4 opened in 7 d", tone: "danger" });
    expect(tile.hint).toBe("+3 vs previous 7 d");
  });

  it("flags a worker that stopped reporting", () => {
    const tile = byLabel("Workers online");
    expect(tile.value).toBe("1 of 2");
    expect(tile.tone).toBe("danger");
    expect(tile.detail).toBe("1 primary · 1 fallback");
  });

  it("says nothing it cannot know while a section is still loading", () => {
    const tiles = buildKpis({});
    expect(tiles.every((kpi) => kpi.value === "—")).toBe(true);
    expect(tiles.every((kpi) => kpi.spark === undefined && kpi.delta === undefined)).toBe(true);
  });

  it("keeps the tiles that have a source when analytics is the one that failed", () => {
    // The strip renders outside every Section precisely so this stays true: an
    // analytics outage must not take the workers and workspace counts with it.
    const tiles = buildKpis({
      overview,
      workers: { now: 0, workers: [worker("mac", "local", true)] },
    });
    const byName = new Map(tiles.map((kpi) => [kpi.label, kpi]));
    expect(byName.get("Workspaces")).toMatchObject({ detail: undefined, value: "44" });
    expect(byName.get("Workers online")).toMatchObject({ value: "1 of 1" });
    expect(byName.get("Users")?.value).toBe("—");
    expect(byName.get("MRR")?.value).toBe("—");
  });

  it("keeps the quiet copy when today has not started and nothing is wrong", () => {
    const quiet = buildKpis({
      analytics: {
        ...analytics,
        business: { ...analytics.business, openIncidents: 0 },
        checks: checks.map((day) => ({ ...day, down: 0, up: 0 })),
        incidents: incidents.map((day) => ({ ...day, opened: 0 })),
        runs: runs.map((day) => ({ ...day, passed: 0, total: 0 })),
      },
      overview,
      workers: { now: 0, workers: [] },
    });
    expect(quiet.find((kpi) => kpi.label === "Runs today")?.hint).toBe("No runs yet today");
    expect(quiet.find((kpi) => kpi.label === "Checks today")?.hint).toBe("No checks yet today");
    expect(quiet.find((kpi) => kpi.label === "Open incidents")?.tone).toBeUndefined();
    expect(quiet.find((kpi) => kpi.label === "Workers online")?.detail).toBe(
      "No workers have reported yet",
    );
  });

  it("explains the pending migration instead of reporting zero workers online", () => {
    const tiles = buildKpis({ analytics, overview, workers: { unavailable: "MIGRATION_PENDING" } });
    const tile = tiles.find((kpi) => kpi.label === "Workers online");
    expect(tile?.value).toBe("—");
    expect(tile?.detail).toBe("Pending production migration");
  });
});
