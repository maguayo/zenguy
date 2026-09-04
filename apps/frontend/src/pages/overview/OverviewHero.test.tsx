import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Incident, Overview } from "../../api/types";
import {
  OverviewHero,
  compactDuration,
  compactRelative,
  heroHeadline,
  heroState,
} from "./OverviewHero";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function overview({
  avgResponseTimeMs24h = 215,
  failed24h = 0,
  monitors = { up: 10 },
  openBrowserIncidents = 0,
  openUptimeIncidents = 0,
  tests = 12,
  uptime30d = 99.98,
}: {
  avgResponseTimeMs24h?: number | null;
  failed24h?: number;
  monitors?: { down?: number; unknown?: number; up?: number };
  openBrowserIncidents?: number;
  openUptimeIncidents?: number;
  tests?: number;
  uptime30d?: number | null;
} = {}): Overview {
  return {
    activity: [],
    browserTests: {
      failed24h,
      openIncidents: openBrowserIncidents,
      runningRuns: 0,
      total: tests,
    },
    running: [],
    uptime: {
      avgResponseTimeMs24h,
      down: monitors.down ?? 0,
      openIncidents: openUptimeIncidents,
      unknown: monitors.unknown ?? 0,
      up: monitors.up ?? 0,
      uptime30d,
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
    durationMs: 12 * MINUTE_MS,
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

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
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
    expect(heroHeadline("incident", 1)).toBe("1 open incident");
    expect(heroHeadline("incident", 3)).toBe("3 open incidents");
  });

  it("keeps the calm and empty voices", () => {
    expect(heroHeadline("calm", 0)).toBe("All clear");
    expect(heroHeadline("empty", 0)).toBe("Nothing under watch yet");
  });
});

describe("compactDuration", () => {
  it("formats seconds, minutes, and hours compactly", () => {
    expect(compactDuration(0)).toBe("1 s");
    expect(compactDuration(42_000)).toBe("42 s");
    expect(compactDuration(14 * MINUTE_MS + 32_000)).toBe("14 m");
    expect(compactDuration(4 * HOUR_MS)).toBe("4 h");
    expect(compactDuration(4 * HOUR_MS + 35 * MINUTE_MS)).toBe("4 h 35 m");
  });

  it("does not invent a duration for missing or invalid data", () => {
    expect(compactDuration(null)).toBe("—");
    expect(compactDuration(Number.NaN)).toBe("—");
    expect(compactDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("compactRelative", () => {
  it("formats recent timestamps in English compact units", () => {
    expect(compactRelative(iso(30_000))).toBe("now");
    expect(compactRelative(iso(12 * MINUTE_MS))).toBe("12m ago");
    expect(compactRelative(iso(4 * HOUR_MS + 20 * MINUTE_MS))).toBe("4h ago");
    expect(compactRelative(iso(6 * DAY_MS))).toBe("6d ago");
  });

  it("handles future and invalid timestamps safely", () => {
    expect(compactRelative(iso(-5 * MINUTE_MS))).toBe("now");
    expect(compactRelative("not-a-date")).toBe("—");
  });
});

describe("OverviewHero render", () => {
  it("renders the calm story, metrics, and incident-history link", () => {
    const html = renderHero({
      lastIncident: incident({
        durationMs: 4 * HOUR_MS + 35 * MINUTE_MS,
        openedAt: iso(6 * DAY_MS),
        resolvedAt: iso(6 * DAY_MS - (4 * HOUR_MS + 35 * MINUTE_MS)),
        status: "RESOLVED",
      }),
      overview: overview({
        avgResponseTimeMs24h: 214.6,
        failed24h: 2,
        uptime30d: 99.987,
      }),
    });
    const text = visibleText(html);

    expect(text).toContain("All clear");
    expect(text).toContain("Last incident 6d ago — resolved in 4 h 35 m");
    expect(text).toContain(
      "Uptime 30 d 99.99 % Response 24 h 215 ms Failures 24 h 2 Incidents 0",
    );
    expect(html).toMatch(/<p class="[^"]*\bwhitespace-nowrap\b[^"]*">Uptime 30 d<\/p>/u);
    expect(html).toMatch(/<p class="[^"]*\bwhitespace-nowrap\b[^"]*">Response 24 h<\/p>/u);
    expect(html).toMatch(/<p class="[^"]*\bwhitespace-nowrap\b[^"]*">Failures 24 h<\/p>/u);
    expect(html).toMatch(/<p class="[^"]*\bwhitespace-nowrap\b[^"]*">Incidents<\/p>/u);
    expect(html).toMatch(
      /<p class="[^"]*\bwhitespace-nowrap\b[^"]*">215 <span class="[^"]*">ms<\/span><\/p>/u,
    );
    expect(html).not.toMatch(/class="[^"]*\bblock\b[^"]*">ms<\/span>/u);
    expect(html).toContain('href="/w/ws_1/incidents"');
    expect(text).toContain("History");
  });

  it("renders an open incident with danger metrics and the filtered incidents link", () => {
    const html = renderHero({
      openIncident: incident(),
      overview: overview({
        avgResponseTimeMs24h: null,
        failed24h: 3,
        monitors: { down: 1, up: 9 },
        openUptimeIncidents: 1,
        uptime30d: 98.75,
      }),
    });
    const text = visibleText(html);

    expect(text).toContain("1 open incident");
    expect(text).toContain("An incident affecting Checkout API opened 12m ago.");
    expect(text).toContain(
      "Uptime 30 d 98.75 % Response 24 h — Failures 24 h 3 Incidents 1",
    );
    expect(html).toContain('href="/w/ws_1/incidents?status=open"');
    expect(text).toContain("View incidents");
  });

  it("renders the empty state and routes managers to create their first test", () => {
    const html = renderHero({
      overview: overview({
        avgResponseTimeMs24h: null,
        monitors: {},
        tests: 0,
        uptime30d: null,
      }),
    });
    const text = visibleText(html);

    expect(text).toContain("Nothing under watch yet");
    expect(text).toContain("Create a test or monitor to start watching your services.");
    expect(text).toContain(
      "Uptime 30 d — Response 24 h — Failures 24 h 0 Incidents 0",
    );
    expect(html).toContain('href="/w/ws_1/tests/new"');
    expect(text).toContain("Get started");
  });

  it("routes members without manage rights to the tests list", () => {
    const html = renderHero({
      canManageTests: false,
      overview: overview({ tests: 0, monitors: {} }),
    });

    expect(html).toContain('href="/w/ws_1/tests"');
    expect(visibleText(html)).toContain("Get started");
  });
});
