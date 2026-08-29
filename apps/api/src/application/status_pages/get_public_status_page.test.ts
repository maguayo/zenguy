import type { BrowserTest } from "../../domain/browser_tests/types";
import type { Incident } from "../../domain/incidents/types";
import type { StatusPage, StatusPageItem } from "../../domain/status_pages/types";
import type { TestRun } from "../../domain/browser_tests/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import { FixedClock } from "../../shared/clock";
import { FakeBrowserTestRepo, FakeRunRepo } from "../../test/fakes/browser_test_repos";
import { FakeIncidentRepo } from "../../test/fakes/incident_repos";
import {
  FakeIncidentUpdateRepo,
  FakeStatusPageItemRepo,
  FakeStatusPageRepo,
} from "../../test/fakes/status_page_repos";
import { FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import { DAY_MS } from "./availability";
import { GetPublicStatusPage } from "./get_public_status_page";

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);
const CREATED = NOW - 100 * DAY_MS;
const SECRET_URL = "https://secret-internal.example.com/healthz";
const SECRET_NAME = "prod-db-healthz internal";

function page(overrides: Partial<StatusPage> = {}): StatusPage {
  return {
    id: "sp_1",
    workspaceId: "ws_1",
    slug: "acme",
    title: "Acme Status",
    description: "Service health",
    accentColor: "#22c55e",
    theme: "SYSTEM",
    publishedAt: NOW - DAY_MS,
    createdBy: "usr_1",
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    ...overrides,
  };
}

function monitor(id: string, overrides: Partial<UptimeMonitor> = {}): UptimeMonitor {
  return {
    id,
    workspaceId: "ws_1",
    name: SECRET_NAME,
    url: SECRET_URL,
    method: "GET",
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt: NOW,
    currentStatus: "UP",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: NOW,
    lastResponseTimeMs: 120,
    createdBy: "usr_1",
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    ...overrides,
  };
}

function browserTest(id: string, overrides: Partial<BrowserTest> = {}): BrowserTest {
  return {
    id,
    workspaceId: "ws_1",
    name: "internal checkout test",
    allowedDomains: [],
    writableDomains: [],
    testDataAttested: false,
    irreversibleActionScopes: [],
    startUrl: "https://shop.example.com/checkout",
    instructions: "Buy the sample product with the staging card",
    device: "DESKTOP",
    intervalHours: 6,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextRunAt: NOW,
    createdBy: "usr_1",
    updatedBy: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    ...overrides,
  };
}

function item(
  id: string,
  resource: { monitorId?: string; testId?: string },
  position: number,
  displayName: string,
): StatusPageItem {
  return {
    id,
    statusPageId: "sp_1",
    workspaceId: "ws_1",
    resourceType: resource.testId === undefined ? "UPTIME_MONITOR" : "BROWSER_TEST",
    browserTestId: resource.testId ?? null,
    uptimeMonitorId: resource.monitorId ?? null,
    displayName,
    groupName: null,
    position,
    createdAt: CREATED,
  };
}

function incident(
  id: string,
  resource: { monitorId?: string; testId?: string },
  openedAt: number,
  resolvedAt: number | null,
): Incident {
  return {
    id,
    workspaceId: "ws_1",
    resourceType: resource.testId === undefined ? "UPTIME_MONITOR" : "BROWSER_TEST",
    browserTestId: resource.testId ?? null,
    uptimeMonitorId: resource.monitorId ?? null,
    status: resolvedAt === null ? "OPEN" : "RESOLVED",
    openedAt,
    resolvedAt,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: `chk_${id}`,
    resolvedByCheckId: null,
    lastEventAt: openedAt,
    createdAt: openedAt,
  };
}

function finishedRun(id: string, testId: string): TestRun {
  return {
    id,
    workspaceId: "ws_1",
    browserTestId: testId,
    source: "SCHEDULED",
    status: "PASSED",
    snapshot: {
      name: "internal checkout test",
      allowedDomains: [],
      writableDomains: [],
      startUrl: "https://shop.example.com/checkout",
      instructions: "Buy the sample product with the staging card",
      device: "DESKTOP",
      intervalHours: 6,
      maxRetries: 0,
      notifyOnRecovery: true,
      channelIds: [],
      viewport: { width: 1440, height: 900 },
      modelName: "test-model",
      runnerVersion: "test-runner",
    },
    scheduledFor: null,
    queuedAt: NOW - DAY_MS,
    startedAt: NOW - DAY_MS,
    finishedAt: NOW - DAY_MS + 60_000,
    durationMs: 60_000,
    attemptCount: 1,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: null,
    triggeredByUserId: null,
    incidentId: null,
    createdAt: NOW - DAY_MS,
  };
}

function build() {
  const pages = new FakeStatusPageRepo();
  const items = new FakeStatusPageItemRepo();
  const monitors = new FakeMonitorRepo();
  const tests = new FakeBrowserTestRepo();
  const runs = new FakeRunRepo();
  const incidents = new FakeIncidentRepo();
  const updates = new FakeIncidentUpdateRepo();
  const useCase = new GetPublicStatusPage(
    pages,
    items,
    monitors,
    tests,
    runs,
    incidents,
    updates,
    new FixedClock(NOW),
  );
  return { pages, items, monitors, tests, runs, incidents, updates, useCase };
}

describe("GetPublicStatusPage", () => {
  it("builds the sanitized public view with states, bars, incidents and updates", async () => {
    const { pages, items, monitors, tests, runs, incidents, updates, useCase } =
      build();
    await pages.insert(page());
    await monitors.insert(monitor("mon_1"));
    tests.tests.set("bt_1", browserTest("bt_1"));
    runs.runs.set("run_1", finishedRun("run_1", "bt_1"));
    await items.insert(item("spi_mon", { monitorId: "mon_1" }, 0, "Public API"));
    await items.insert(item("spi_bt", { testId: "bt_1" }, 1, "Checkout flow"));

    await incidents.insertOpen(
      incident("inc_open", { monitorId: "mon_1" }, NOW - 3_600_000, null),
    );
    await updates.insert({
      id: "iu_1",
      incidentId: "inc_open",
      workspaceId: "ws_1",
      message: "We are investigating.",
      createdBy: "usr_1",
      createdAt: NOW - 1_800_000,
    });

    const view = await useCase.bySlug("acme");
    expect(view).not.toBeNull();
    if (view === null) throw new Error("unreachable");

    expect(view.title).toBe("Acme Status");
    expect(view.overall).toBe("PARTIAL_OUTAGE");
    expect(view.items.map((entry) => entry.displayName)).toEqual([
      "Public API",
      "Checkout flow",
    ]);
    const monitorItem = view.items[0];
    const testItem = view.items[1];
    expect(monitorItem?.state).toBe("DOWN");
    expect(monitorItem?.days).toHaveLength(90);
    expect(monitorItem?.days.at(-1)?.downtimeSeconds).toBe(3_600);
    expect(monitorItem?.uptimePercent).toBeLessThan(100);
    expect(testItem?.state).toBe("OPERATIONAL");
    expect(testItem?.uptimePercent).toBe(100);

    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0]?.displayName).toBe("Public API");
    expect(view.incidents[0]?.status).toBe("ONGOING");
    expect(view.incidents[0]?.updates[0]?.message).toBe("We are investigating.");

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(SECRET_URL);
    expect(serialized).not.toContain(SECRET_NAME);
    expect(serialized).not.toContain("mon_1");
    expect(serialized).not.toContain("bt_1");
    expect(serialized).not.toContain("inc_open");
    expect(serialized).not.toContain("shop.example.com");
    expect(serialized).not.toContain("staging card");
  });

  it("excludes old resolved incidents from the list but keeps them in the bars", async () => {
    const { pages, items, monitors, incidents, useCase } = build();
    await pages.insert(page());
    await monitors.insert(monitor("mon_1"));
    await items.insert(item("spi_mon", { monitorId: "mon_1" }, 0, "Public API"));
    const openedAt = NOW - 20 * DAY_MS;
    await incidents.insertOpen(
      incident("inc_old", { monitorId: "mon_1" }, openedAt, openedAt + 7_200_000),
    );

    const view = await useCase.bySlug("acme");
    if (view === null) throw new Error("unreachable");
    expect(view.incidents).toEqual([]);
    expect(view.items[0]?.state).toBe("OPERATIONAL");
    const dayWithOutage = view.items[0]?.days.find(
      (day) => day.downtimeSeconds > 0,
    );
    expect(dayWithOutage?.downtimeSeconds).toBe(7_200);
    expect(view.overall).toBe("OPERATIONAL");
  });

  it("marks never-run resources as PENDING and keeps them out of the overall banner", async () => {
    const { pages, items, monitors, tests, useCase } = build();
    await pages.insert(page());
    await monitors.insert(monitor("mon_new", { currentStatus: "UNKNOWN" }));
    tests.tests.set("bt_new", browserTest("bt_new"));
    await items.insert(item("spi_mon", { monitorId: "mon_new" }, 0, "API"));
    await items.insert(item("spi_bt", { testId: "bt_new" }, 1, "Checkout"));

    const view = await useCase.bySlug("acme");
    if (view === null) throw new Error("unreachable");
    expect(view.items.map((entry) => entry.state)).toEqual([
      "PENDING",
      "PENDING",
    ]);
    expect(view.items.every((entry) => entry.uptimePercent === null)).toBe(true);
    expect(view.overall).toBe("OPERATIONAL");
  });

  it("filters items whose resources were deleted or belong to another workspace", async () => {
    const { pages, items, monitors, useCase } = build();
    await pages.insert(page());
    await monitors.insert(monitor("mon_dead", { deletedAt: NOW - 1 }));
    await monitors.insert(monitor("mon_foreign", { workspaceId: "ws_2" }));
    await items.insert(item("spi_dead", { monitorId: "mon_dead" }, 0, "Dead"));
    await items.insert(
      item("spi_foreign", { monitorId: "mon_foreign" }, 1, "Foreign"),
    );

    const view = await useCase.bySlug("acme");
    if (view === null) throw new Error("unreachable");
    expect(view.items).toEqual([]);
    expect(view.overall).toBe("OPERATIONAL");
  });

  it("hides drafts from bySlug but serves them via byId, and declares MAJOR_OUTAGE when everything is down", async () => {
    const { pages, items, monitors, incidents, useCase } = build();
    await pages.insert(page({ publishedAt: null }));
    await monitors.insert(monitor("mon_1"));
    await items.insert(item("spi_mon", { monitorId: "mon_1" }, 0, "API"));
    await incidents.insertOpen(
      incident("inc_open", { monitorId: "mon_1" }, NOW - 60_000, null),
    );

    expect(await useCase.bySlug("acme")).toBeNull();
    expect(await useCase.bySlug("missing")).toBeNull();

    const draft = await useCase.byId("ws_1", "sp_1");
    if (draft === null) throw new Error("unreachable");
    expect(draft.overall).toBe("MAJOR_OUTAGE");
    expect(await useCase.byId("ws_2", "sp_1")).toBeNull();
  });
});
