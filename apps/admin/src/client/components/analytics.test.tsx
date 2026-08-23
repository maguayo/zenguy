import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ActiveWorkspaceRow,
  AnalyticsBusiness,
  DeliveriesDay,
  MonitorDownRow,
  OpenIncidentRow,
  TestLeaderboardRow,
} from "../../shared/types";
import { ActiveWorkspacesTable } from "./ActiveWorkspacesTable";
import { AlertSpendCard } from "./AlertSpendCard";
import { KpiCard } from "./KpiCard";
import { MonitorsCard } from "./MonitorsCard";
import { OpenIncidentsCard } from "./OpenIncidentsCard";
import { RangeSwitch } from "./RangeSwitch";
import { TestLeaderboard } from "./TestLeaderboard";

const NOW = 1_800_000_000_000;

describe("range switch", () => {
  it("offers the three windows and marks the one in force", () => {
    const html = renderToStaticMarkup(<RangeSwitch onChange={() => {}} value={30} />);
    expect(html).toContain("7 d");
    expect(html).toContain("30 d");
    expect(html).toContain("90 d");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    const active = html.split("<button").find((chunk) => chunk.includes(">30 d<"));
    expect(active).toContain('aria-pressed="true"');
  });
});

describe("kpi card", () => {
  it("shows the value, its delta and the supporting line", () => {
    const html = renderToStaticMarkup(
      <KpiCard
        kpi={{
          delta: { text: "+7 in 7 d", tone: "ok" },
          hint: "+7 vs previous 7 d",
          label: "Users",
          value: "120",
        }}
      />,
    );
    expect(html).toContain("Users");
    expect(html).toContain("120");
    expect(html).toContain("+7 in 7 d");
    expect(html).toContain("text-ok-700");
  });

  it("puts a verdict number in the status colour and keeps the rest neutral", () => {
    const alarmed = renderToStaticMarkup(
      <KpiCard kpi={{ detail: "1 primary · 1 fallback", label: "Workers online", tone: "danger", value: "1 of 2" }} />,
    );
    expect(alarmed).toContain("text-danger-700");
    expect(alarmed).toContain("1 primary · 1 fallback");
    const calm = renderToStaticMarkup(<KpiCard kpi={{ label: "Workspaces", value: "44" }} />);
    expect(calm).not.toContain("text-danger-700");
  });
});

describe("monitors card", () => {
  const monitors = { down: 1, total: 5, unknown: 1, up: 3 };

  it("names the monitors that are down and how long they have been", () => {
    const rows: MonitorDownRow[] = [
      { monitorId: "mon_1", name: "api.acme.com", since: NOW - 124_000, workspaceName: "Acme" },
    ];
    const html = renderToStaticMarkup(<MonitorsCard monitors={monitors} now={NOW} rows={rows} />);
    expect(html).toContain("api.acme.com");
    expect(html).toContain("Acme");
    expect(html).toContain("down for 2m 4s");
    expect(html).toContain("UP 3");
  });

  it("says so plainly when nothing is down", () => {
    const html = renderToStaticMarkup(
      <MonitorsCard monitors={{ down: 0, total: 5, unknown: 0, up: 5 }} now={NOW} rows={[]} />,
    );
    expect(html).toContain("Every monitor is up");
  });

  it("will not claim every monitor is up before the list has arrived", () => {
    // The badges and the list come from two different queries: a DOWN badge
    // beside "every monitor is up" is the contradiction this prevents.
    const html = renderToStaticMarkup(
      <MonitorsCard monitors={monitors} now={NOW} rows={undefined} />,
    );
    expect(html).toContain("DOWN 1");
    expect(html).toContain("Loading failing monitors…");
    expect(html).not.toContain("Every monitor is up");
  });

  it("does not pretend to know when a monitor started failing", () => {
    const rows: MonitorDownRow[] = [
      { monitorId: "mon_1", name: "api.acme.com", since: null, workspaceName: null },
    ];
    const html = renderToStaticMarkup(<MonitorsCard monitors={monitors} now={NOW} rows={rows} />);
    expect(html).toContain("down for an unknown time");
  });
});

describe("open incidents card", () => {
  it("lists what is open with the age of each", () => {
    const incidents: OpenIncidentRow[] = [
      {
        incidentId: "inc_1",
        openedAt: NOW - 124_000,
        resourceName: "Checkout",
        resourceType: "BROWSER_TEST",
        workspaceName: "Acme",
      },
      {
        incidentId: "inc_2",
        openedAt: NOW - 4_000,
        resourceName: null,
        resourceType: "UPTIME_MONITOR",
        workspaceName: null,
      },
    ];
    const html = renderToStaticMarkup(<OpenIncidentsCard incidents={incidents} now={NOW} />);
    expect(html).toContain("Checkout");
    expect(html).toContain("Browser test");
    expect(html).toContain("Monitor");
    expect(html).toContain("2m 4s ago");
    expect(html).toContain("Unnamed resource");
  });

  it("celebrates an empty list rather than showing an empty table", () => {
    const html = renderToStaticMarkup(<OpenIncidentsCard incidents={[]} now={NOW} />);
    expect(html).toContain("Nothing is open right now");
  });
});

describe("alert spend card", () => {
  const business = {
    activeUsers30d: 0,
    activeUsers7d: 0,
    creditTopupsCents30d: 5_000,
    freeWorkspaces: 0,
    grantWorkspaces: 0,
    mrrCents: 0,
    openIncidents: 0,
    payingWorkspaces: 0,
  } satisfies AnalyticsBusiness;

  it("totals what the alerts cost over the range and what was topped up", () => {
    const deliveries: DeliveriesDay[] = [
      {
        byChannel: { CALL: 0, DISCORD: 0, EMAIL: 1, PUSH: 0, SLACK: 0, SMS: 1, WHATSAPP: 0 },
        costCents: 420,
        day: "2026-08-23",
      },
      {
        byChannel: { CALL: 0, DISCORD: 0, EMAIL: 1, PUSH: 0, SLACK: 0, SMS: 0, WHATSAPP: 0 },
        costCents: 80,
        day: "2026-08-22",
      },
    ];
    const html = renderToStaticMarkup(
      <AlertSpendCard business={business} days={30} deliveries={deliveries} />,
    );
    // Anchored on the closing tag: a bare "€5" is also satisfied by "€50".
    expect(html).toContain(">€5</p>");
    expect(html).toContain("Last 30 days");
    expect(html).toContain(">€50</dd>");
    expect(html).toContain("Credits bought 30 d");
  });
});

describe("test leaderboards", () => {
  const failing: TestLeaderboardRow = {
    avgDurationMs: 64_000,
    failed: 4,
    name: "Checkout",
    passRate: 0.6,
    runs: 10,
    testId: "test_1",
    workspaceName: "Acme",
  };

  it("ranks failures with the workspace they belong to", () => {
    const html = renderToStaticMarkup(
      <TestLeaderboard kind="failing" rows={[failing]} title="Top failing tests" />,
    );
    expect(html).toContain("Checkout");
    expect(html).toContain("Acme");
    expect(html).toContain("60%");
    expect(html).toContain("Failed");
  });

  it("ranks the slow ones by the time they take", () => {
    const html = renderToStaticMarkup(
      <TestLeaderboard kind="slow" rows={[failing]} title="Slowest tests" />,
    );
    expect(html).toContain("1m 04s");
    expect(html).not.toContain("Failed");
  });

  it("says nothing failed rather than drawing an empty table", () => {
    const html = renderToStaticMarkup(
      <TestLeaderboard kind="failing" rows={[]} title="Top failing tests" />,
    );
    expect(html).toContain("No test failed in the last 7 days");
  });
});

describe("active workspaces table", () => {
  const row: ActiveWorkspaceRow = {
    lastRunAt: NOW - 124_000,
    monitors: 3,
    name: "Acme",
    runs: 120,
    subscription: "paddle",
    workspaceId: "ws_1",
  };

  it("shows how each workspace pays and when it last ran something", () => {
    const html = renderToStaticMarkup(<ActiveWorkspacesTable now={NOW} rows={[row]} />);
    expect(html).toContain("Acme");
    expect(html).toContain("Paying");
    expect(html).toContain("120");
    expect(html).toContain("2m 4s ago");
  });

  it("handles a workspace with no run and no plan", () => {
    const html = renderToStaticMarkup(
      <ActiveWorkspacesTable now={NOW} rows={[{ ...row, lastRunAt: null, subscription: "none" }]} />,
    );
    expect(html).toContain("Never");
    expect(html).toContain("No plan");
  });

  it("says nothing ran rather than drawing an empty table", () => {
    const html = renderToStaticMarkup(<ActiveWorkspacesTable now={NOW} rows={[]} />);
    expect(html).toContain("No workspace ran anything in the last 30 days");
  });
});
