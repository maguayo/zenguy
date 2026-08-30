import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityItem, ActivityType, Incident, Overview } from "../../api/types";
import {
  OverviewHero,
  heroHeadline,
  heroState,
  liveChip,
  pulseLabel,
  pulseSlots,
  tickTone,
} from "./OverviewHero";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function activity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "activity_1",
    link: { runId: "run_1" },
    occurredAt: iso(HOUR_MS),
    resourceId: "bt_1",
    resourceName: "Checkout",
    resourceType: "BROWSER_TEST",
    title: "Checkout passed",
    type: "TEST_PASSED",
    ...overrides,
  };
}

function overview(overrides: {
  activity?: ActivityItem[];
  failed24h?: number;
  openBrowserIncidents?: number;
  openUptimeIncidents?: number;
  monitors?: { down?: number; unknown?: number; up?: number };
  running?: Overview["running"];
  runningRuns?: number;
  tests?: number;
} = {}): Overview {
  const monitors = overrides.monitors ?? { up: 10 };
  return {
    activity: overrides.activity ?? [],
    browserTests: {
      failed24h: overrides.failed24h ?? 0,
      openIncidents: overrides.openBrowserIncidents ?? 0,
      runningRuns: overrides.runningRuns ?? 0,
      total: overrides.tests ?? 12,
    },
    running: overrides.running,
    uptime: {
      avgResponseTimeMs24h: null,
      down: monitors.down ?? 0,
      openIncidents: overrides.openUptimeIncidents ?? 0,
      unknown: monitors.unknown ?? 0,
      up: monitors.up ?? 0,
      uptime30d: null,
    },
    usage: {
      billableRuns: 0,
      currency: "EUR",
      includedRuns: 300,
      overageAmountCents: 0,
      overageRuns: 0,
      periodEnd: iso(-5 * 24 * HOUR_MS),
      periodStart: iso(25 * 24 * HOUR_MS),
      projectedTotalCents: 0,
      remainingRuns: 300,
    },
  };
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    durationMs: 12 * 60 * 1_000,
    id: "inc_1",
    lastEventAt: iso(0),
    openedAt: iso(12 * 60 * 1_000),
    resolvedAt: null,
    resourceId: "mon_1",
    resourceName: "Checkout API",
    resourceType: "UPTIME_MONITOR",
    status: "OPEN",
    ...overrides,
  };
}

function renderHero(props: Partial<Parameters<typeof OverviewHero>[0]> = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OverviewHero
        canManageTests
        lastIncident={undefined}
        openIncident={undefined}
        overview={overview()}
        workspaceId="ws_1"
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tickTone", () => {
  it("maps every activity type to a pulse tone", () => {
    const expected: Record<ActivityType, string> = {
      CHANNEL_DELIVERY_FAILED: "warn",
      MONITOR_DOWN: "fail",
      MONITOR_RECOVERED: "ok",
      TEST_FAILED: "fail",
      TEST_PASSED: "ok",
      TEST_RECOVERED: "ok",
      TEST_SYSTEM_ERROR: "warn",
      TEST_TIMEOUT: "warn",
    };
    for (const [type, tone] of Object.entries(expected)) {
      expect(tickTone(type as ActivityType)).toBe(tone);
    }
  });
});

describe("pulseSlots", () => {
  it("pads sparse history with leading empty slots up to thirty-two", () => {
    const slots = pulseSlots(
      [
        activity({ id: "a_new", occurredAt: iso(HOUR_MS), title: "Checkout passed" }),
        activity({
          id: "a_old",
          occurredAt: iso(2 * HOUR_MS),
          title: "Search failed",
          type: "TEST_FAILED",
        }),
      ],
      [],
    );

    expect(slots).toHaveLength(32);
    expect(slots.slice(0, 30).every((slot) => slot.tone === "empty")).toBe(true);
    expect(slots[30]).toMatchObject({ label: "Search failed · 2h ago", tone: "fail" });
    expect(slots[31]).toMatchObject({ label: "Checkout passed · 1h ago", tone: "ok" });
  });

  it("appends running runs after the newest result", () => {
    const slots = pulseSlots(
      [activity()],
      [{ browserTestId: "bt_1", id: "run_live", startedAt: iso(30_000), testName: "Add to cart" }],
    );

    expect(slots[31]).toMatchObject({ label: "Add to cart · running", tone: "run" });
    expect(slots[30]).toMatchObject({ tone: "ok" });
  });

  it("drops the oldest results when history plus running overflow thirty-two", () => {
    const history = Array.from({ length: 32 }, (_, index) =>
      activity({ id: `a_${index}`, occurredAt: iso((index + 1) * HOUR_MS) }),
    );
    const slots = pulseSlots(history, [
      { browserTestId: "bt_1", id: "run_live", startedAt: iso(0), testName: "Add to cart" },
    ]);

    expect(slots).toHaveLength(32);
    expect(slots[0]).toMatchObject({ tone: "ok" });
    expect(slots[31]).toMatchObject({ tone: "run" });
  });
});

describe("pulseLabel", () => {
  it("summarises the visible slots for screen readers", () => {
    const slots = pulseSlots(
      [
        activity({ id: "a_1" }),
        activity({ id: "a_2", type: "TEST_FAILED" }),
        activity({ id: "a_3", type: "TEST_TIMEOUT" }),
      ],
      [{ browserTestId: "bt_1", id: "run_live", startedAt: iso(0), testName: "Add to cart" }],
    );

    expect(pulseLabel(slots)).toBe(
      "Last 4 results, oldest first: 1 passed, 1 failed, 1 warning, 1 running.",
    );
  });

  it("describes an empty strip", () => {
    expect(pulseLabel(pulseSlots([], []))).toBe("No results yet.");
  });
});

describe("liveChip", () => {
  it("returns nothing when no run is in flight", () => {
    expect(liveChip([], 0)).toBeNull();
  });

  it("names the newest running run", () => {
    expect(
      liveChip(
        [{ browserTestId: "bt_1", id: "run_live", startedAt: iso(0), testName: "Add to cart" }],
        1,
      ),
    ).toEqual({ label: "Add to cart · running", runId: "run_live" });
  });

  it("counts the extra runs beyond the named one", () => {
    expect(
      liveChip(
        [
          { browserTestId: "bt_1", id: "run_a", startedAt: iso(0), testName: "Add to cart" },
          { browserTestId: "bt_2", id: "run_b", startedAt: iso(1_000), testName: "Login" },
        ],
        3,
      ),
    ).toEqual({ label: "Add to cart +2 · running", runId: "run_a" });
  });

  it("falls back to a count when the API sends no run details", () => {
    expect(liveChip(undefined, 2)).toEqual({ label: "2 running", runId: null });
  });
});

describe("heroState", () => {
  it("reports incidents whenever any incident is open", () => {
    expect(heroState(overview({ openBrowserIncidents: 1, tests: 0, monitors: {} }))).toBe(
      "incident",
    );
    expect(heroState(overview({ openUptimeIncidents: 2 }))).toBe("incident");
  });

  it("is empty when nothing is under watch", () => {
    expect(heroState(overview({ tests: 0, monitors: {} }))).toBe("empty");
  });

  it("is calm when checks exist and nothing is open", () => {
    expect(heroState(overview())).toBe("calm");
  });
});

describe("heroHeadline", () => {
  it("counts open incidents", () => {
    expect(heroHeadline("incident", 1)).toBe("1 incident open.");
    expect(heroHeadline("incident", 3)).toBe("3 incidents open.");
  });

  it("keeps the calm and empty voices", () => {
    expect(heroHeadline("calm", 0)).toBe("All quiet.");
    expect(heroHeadline("empty", 0)).toBe("Nothing under watch yet.");
  });
});

describe("OverviewHero render", () => {
  it("tells the story of the newest open incident", () => {
    const html = renderHero({
      openIncident: incident(),
      overview: overview({ openUptimeIncidents: 1, monitors: { down: 1, up: 9 } }),
    });

    expect(html).toContain("1 incident open.");
    expect(html).toContain("<strong");
    expect(html).toContain("Checkout API");
    expect(html).toContain("went down 12m ago.");
    expect(html).toContain('href="/w/ws_1/incidents?status=open"');
    expect(html).toContain("Open incidents");
  });

  it("describes failing browser tests and counts the other open incidents", () => {
    const html = renderHero({
      openIncident: incident({
        resourceName: "Checkout flow",
        resourceType: "BROWSER_TEST",
      }),
      overview: overview({ openBrowserIncidents: 2, openUptimeIncidents: 1 }),
    });

    expect(html).toContain("3 incidents open.");
    expect(html).toContain("Checkout flow");
    expect(html).toContain("started failing 12m ago.");
    expect(html).toContain("2 more incidents are open.");
  });

  it("remembers the last incident when all is quiet", () => {
    const html = renderHero({
      lastIncident: incident({
        durationMs: 14 * 60 * 1_000,
        openedAt: iso(6 * 24 * HOUR_MS),
        resolvedAt: iso(6 * 24 * HOUR_MS - 14 * 60 * 1_000),
        resourceName: "Checkout flow",
        resourceType: "BROWSER_TEST",
        status: "RESOLVED",
      }),
      overview: overview({ failed24h: 2 }),
    });

    expect(html).toContain("All quiet.");
    expect(html).toContain("2 failed runs in the last 24 h.");
    expect(html).toContain("Last incident:");
    expect(html).toContain("Checkout flow");
    expect(html).toContain("6d ago — resolved in 14m 00s.");
    expect(html).toContain('href="/w/ws_1/incidents"');
    expect(html).toContain("Incident history");
  });

  it("says so when there has never been an incident", () => {
    const html = renderHero({ lastIncident: null });

    expect(html).toContain("All quiet.");
    expect(html).toContain("No incidents so far.");
  });

  it("shows counts and the live chip linking to the running run", () => {
    const html = renderHero({
      overview: overview({
        running: [
          { browserTestId: "bt_1", id: "run_live", startedAt: iso(0), testName: "Add to cart" },
        ],
        runningRuns: 1,
      }),
    });

    expect(html).toContain("12 tests · 10 monitors");
    expect(html).toContain("Add to cart · running");
    expect(html).toContain('href="/w/ws_1/runs/run_live"');
  });

  it("uses singular nouns for a single test and monitor", () => {
    const html = renderHero({
      overview: overview({ monitors: { up: 1 }, tests: 1 }),
    });

    expect(html).toContain("1 test · 1 monitor");
  });

  it("labels the pulse strip for screen readers", () => {
    const html = renderHero({
      overview: overview({ activity: [activity()] }),
    });

    expect(html).toContain('aria-label="Last 1 result, oldest first: 1 passed."');
  });

  it("invites the first test when nothing is under watch", () => {
    const html = renderHero({
      overview: overview({ tests: 0, monitors: {} }),
    });

    expect(html).toContain("Nothing under watch yet.");
    expect(html).toContain('href="/w/ws_1/tests/new"');
    expect(html).toContain("Create your first test");
  });

  it("points members without manage rights at the tests page instead", () => {
    const html = renderHero({
      canManageTests: false,
      overview: overview({ tests: 0, monitors: {} }),
    });

    expect(html).toContain('href="/w/ws_1/tests"');
    expect(html).toContain("View tests");
  });
});
