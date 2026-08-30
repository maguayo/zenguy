import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Incident } from "../../domain/incidents/types";
import type {
  IncidentUpdate,
  StatusPage,
  StatusPageItem,
} from "../../domain/status_pages/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1IncidentUpdateRepo } from "../../infrastructure/db/incident_update_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import {
  D1StatusPageItemRepo,
  D1StatusPageRepo,
} from "../../infrastructure/db/status_page_repo";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const NOW = Date.now();
const SECRET_URL = "https://secret-internal.example.com/healthz";
const SECRET_NAME = "prod-db-healthz internal";

class FakeEdgeCache {
  readonly store = new Map<string, Response>();
  putCalls = 0;
  readonly disabled: boolean;

  constructor(disabled = false) {
    this.disabled = disabled;
  }

  async match(request: Request): Promise<Response | undefined> {
    if (this.disabled) return undefined;
    return this.store.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.putCalls += 1;
    if (this.disabled) return;
    this.store.set(request.url, response);
  }
}

function page(overrides: Partial<StatusPage> = {}): StatusPage {
  return {
    id: "sp_pub",
    workspaceId: "ws_pub",
    slug: "acme",
    title: "Acme Status",
    description: "Service health",
    accentColor: "#22c55e",
    theme: "SYSTEM",
    publishedAt: NOW - 3_600_000,
    customDomain: null,
    customHostnameId: null,
    customDomainStatus: null,
    customDomainCheckedAt: null,
    createdBy: null,
    createdAt: NOW - 30 * 86_400_000,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function monitor(): UptimeMonitor {
  return {
    id: "mon_pub",
    workspaceId: "ws_pub",
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
    lastResponseTimeMs: 42,
    createdBy: null,
    createdAt: NOW - 30 * 86_400_000,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function item(): StatusPageItem {
  return {
    id: "spi_pub",
    statusPageId: "sp_pub",
    workspaceId: "ws_pub",
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: "mon_pub",
    displayName: "Public API",
    groupName: null,
    position: 0,
    createdAt: NOW - 30 * 86_400_000,
  };
}

function incident(): Incident {
  return {
    id: "inc_pub",
    workspaceId: "ws_pub",
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: "mon_pub",
    status: "RESOLVED",
    openedAt: NOW - 2 * 86_400_000,
    resolvedAt: NOW - 2 * 86_400_000 + 5_400_000,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: "chk_pub",
    resolvedByCheckId: null,
    lastEventAt: NOW - 2 * 86_400_000,
    createdAt: NOW - 2 * 86_400_000,
  };
}

function update(): IncidentUpdate {
  return {
    id: "iu_pub",
    incidentId: "inc_pub",
    workspaceId: "ws_pub",
    message: "We identified a database failover and recovered.",
    createdBy: "usr_pub",
    createdAt: NOW - 2 * 86_400_000 + 1_200_000,
  };
}

async function seed(): Promise<void> {
  const bindings = testEnv();
  await new D1StatusPageRepo(bindings.DB).insert(page());
  await new D1MonitorRepo(bindings.DB).insert(monitor());
  await new D1StatusPageItemRepo(bindings.DB).insert(item());
  await new D1IncidentRepo(bindings.DB).insertOpen({
    ...incident(),
    status: "OPEN",
    resolvedAt: null,
  });
  await new D1IncidentRepo(bindings.DB).resolve(
    "inc_pub",
    incident().resolvedAt ?? NOW,
    {},
  );
  await new D1IncidentUpdateRepo(bindings.DB).insert(update());
}

function assertSanitized(body: string): void {
  expect(body).not.toContain(SECRET_URL);
  expect(body).not.toContain(SECRET_NAME);
  expect(body).not.toContain("mon_pub");
  expect(body).not.toContain("inc_pub");
  expect(body).not.toContain("ws_pub");
  expect(body).not.toContain("NOTIFICATION");
}

describe("public status routes", () => {
  let app: Hono<AppEnv>;
  let cache: FakeEdgeCache;

  async function build(disabledCache = false): Promise<void> {
    cache = new FakeEdgeCache(disabledCache);
    app = buildApp(testEnv(), {
      clock: new FixedClock(NOW),
      ids: new FakeIds(),
      statusCache: cache,
    });
  }

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    await seed();
    await build();
  });

  it("serves the published page as sanitized HTML with cache and security headers", async () => {
    const response = await app.request("/status/acme");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();

    const body = await response.text();
    expect(body).toContain("Acme Status");
    expect(body).toContain("Public API");
    expect(body).toContain("We identified a database failover and recovered.");
    expect(body).toContain("Powered by Zenguy");
    expect(body).toContain('http-equiv="refresh"');
    assertSanitized(body);
  });

  it("serves the JSON twin with open CORS and the same sanitization", async () => {
    const response = await app.request("/status/acme/json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    const body = await response.text();
    assertSanitized(body);
    const parsed = JSON.parse(body) as {
      data: { title: string; items: { displayName: string }[] };
    };
    expect(parsed.data.title).toBe("Acme Status");
    expect(parsed.data.items[0]?.displayName).toBe("Public API");
  });

  it("returns one identical generic 404 for missing, draft and deleted slugs", async () => {
    const pages = new D1StatusPageRepo(testEnv().DB);
    await pages.insert(page({ id: "sp_draft", slug: "draft", publishedAt: null }));
    await pages.insert(page({ id: "sp_gone", slug: "gone" }));
    await pages.softDelete("sp_gone", NOW);

    const bodies: string[] = [];
    for (const slug of ["missing", "draft", "gone"]) {
      const response = await app.request(`/status/${slug}`);
      expect(response.status).toBe(404);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("Status page not found");

    const json = await app.request("/status/missing/json");
    expect(json.status).toBe(404);
    await expect(json.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("serves repeat views from the edge cache", async () => {
    const first = await app.request("/status/acme");
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    expect(cache.putCalls).toBe(1);

    const second = await app.request("/status/acme");
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(firstBody);
    expect(cache.putCalls).toBe(1);
  });

  it("rate limits by IP on cache misses", async () => {
    await build(true);
    let lastStatus = 0;
    for (let index = 0; index < 121; index += 1) {
      const response = await app.request("/status/acme", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      });
      lastStatus = response.status;
      if (response.body !== null) await response.body.cancel();
    }
    expect(lastStatus).toBe(429);

    const otherIp = await app.request("/status/acme", {
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });
    expect(otherIp.status).toBe(200);
    if (otherIp.body !== null) await otherIp.body.cancel();
  });
});
