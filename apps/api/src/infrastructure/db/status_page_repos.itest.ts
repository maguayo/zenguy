import type { Incident } from "../../domain/incidents/types";
import type {
  IncidentUpdate,
  StatusPage,
  StatusPageItem,
} from "../../domain/status_pages/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1IncidentRepo } from "./incident_repo";
import { D1IncidentUpdateRepo } from "./incident_update_repo";
import { D1RunRepo } from "./run_repo";
import { D1StatusPageItemRepo, D1StatusPageRepo } from "./status_page_repo";

const NOW = 1_756_400_000_000;

function page(
  id: string,
  slug: string,
  overrides: Partial<StatusPage> = {},
): StatusPage {
  return {
    id,
    workspaceId: "ws_1",
    slug,
    title: "Acme Status",
    description: null,
    accentColor: null,
    theme: "SYSTEM",
    publishedAt: null,
    customDomain: null,
    customHostnameId: null,
    customDomainStatus: null,
    customDomainCheckedAt: null,
    createdBy: "usr_1",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function item(
  id: string,
  pageId: string,
  position: number,
  overrides: Partial<StatusPageItem> = {},
): StatusPageItem {
  return {
    id,
    statusPageId: pageId,
    workspaceId: "ws_1",
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: `mon_${id}`,
    displayName: "API",
    groupName: null,
    position,
    createdAt: NOW,
    ...overrides,
  };
}

function update(
  id: string,
  incidentId: string,
  createdAt: number,
  overrides: Partial<IncidentUpdate> = {},
): IncidentUpdate {
  return {
    id,
    incidentId,
    workspaceId: "ws_1",
    message: `Update ${id}`,
    createdBy: "usr_1",
    createdAt,
    ...overrides,
  };
}

describe("D1StatusPageRepo", () => {
  beforeEach(freshDb);

  it("inserts, finds by id and slug, lists per workspace, updates and publishes", async () => {
    const repo = new D1StatusPageRepo(testEnv().DB);
    await repo.insert(page("sp_a", "acme"));
    await repo.insert(page("sp_b", "acme-internal"));
    await repo.insert(page("sp_c", "other-co", { workspaceId: "ws_2" }));

    expect((await repo.findById("ws_1", "sp_a"))?.slug).toBe("acme");
    expect(await repo.findById("ws_2", "sp_a")).toBeNull();
    expect((await repo.findBySlug("other-co"))?.id).toBe("sp_c");
    expect((await repo.list("ws_1")).map((entry) => entry.id)).toEqual([
      "sp_a",
      "sp_b",
    ]);

    await repo.update(
      "sp_a",
      { title: "Acme Cloud", slug: "acme-cloud", accentColor: "#22c55e" },
      NOW + 1_000,
    );
    const updated = await repo.findById("ws_1", "sp_a");
    expect(updated?.title).toBe("Acme Cloud");
    expect(updated?.slug).toBe("acme-cloud");
    expect(updated?.accentColor).toBe("#22c55e");
    expect(updated?.updatedAt).toBe(NOW + 1_000);
    expect(await repo.findBySlug("acme")).toBeNull();

    await repo.setPublished("sp_a", NOW + 2_000, NOW + 2_000);
    expect((await repo.findById("ws_1", "sp_a"))?.publishedAt).toBe(NOW + 2_000);
    await repo.setPublished("sp_a", null, NOW + 3_000);
    expect((await repo.findById("ws_1", "sp_a"))?.publishedAt).toBeNull();
  });

  it("enforces the global slug uniqueness and frees the slug on soft delete", async () => {
    const repo = new D1StatusPageRepo(testEnv().DB);
    await repo.insert(page("sp_a", "acme"));
    await expect(
      repo.insert(page("sp_dup", "acme", { workspaceId: "ws_2" })),
    ).rejects.toThrow(/UNIQUE/u);

    await repo.softDelete("sp_a", NOW + 1_000);
    expect(await repo.findBySlug("acme")).toBeNull();
    expect(await repo.findById("ws_1", "sp_a")).toBeNull();
    await repo.insert(page("sp_new", "acme", { workspaceId: "ws_2" }));
    expect((await repo.findBySlug("acme"))?.id).toBe("sp_new");
  });

  it("sets, finds, updates and clears custom domains with global uniqueness", async () => {
    const repo = new D1StatusPageRepo(testEnv().DB);
    await repo.insert(page("sp_a", "acme"));
    await repo.insert(page("sp_b", "other", { workspaceId: "ws_2" }));

    await repo.setCustomDomain(
      "sp_a",
      {
        customDomain: "status.example.com",
        customHostnameId: "ch_cf_1",
        status: "PENDING",
        checkedAt: NOW,
      },
      NOW,
    );
    const withDomain = await repo.findByCustomDomain("status.example.com");
    expect(withDomain?.id).toBe("sp_a");
    expect(withDomain?.customDomainStatus).toBe("PENDING");
    expect(withDomain?.customHostnameId).toBe("ch_cf_1");

    await expect(
      repo.setCustomDomain(
        "sp_b",
        {
          customDomain: "status.example.com",
          customHostnameId: "ch_cf_2",
          status: "PENDING",
          checkedAt: NOW,
        },
        NOW,
      ),
    ).rejects.toThrow(/UNIQUE/u);

    await repo.updateCustomDomainStatus("sp_a", "ACTIVE", NOW + 1_000, NOW + 1_000);
    expect(
      (await repo.findByCustomDomain("status.example.com"))?.customDomainStatus,
    ).toBe("ACTIVE");

    await repo.clearCustomDomain("sp_a", NOW + 2_000);
    expect(await repo.findByCustomDomain("status.example.com")).toBeNull();
    expect((await repo.findById("ws_1", "sp_a"))?.customDomain).toBeNull();
    // Freed for someone else.
    await repo.setCustomDomain(
      "sp_b",
      {
        customDomain: "status.example.com",
        customHostnameId: "ch_cf_2",
        status: "PENDING",
        checkedAt: NOW,
      },
      NOW,
    );
    expect((await repo.findByCustomDomain("status.example.com"))?.id).toBe("sp_b");
  });

  it("caps pages per workspace at 5", async () => {
    const repo = new D1StatusPageRepo(testEnv().DB);
    for (let index = 0; index < 5; index += 1) {
      await repo.insert(page(`sp_${index}`, `acme-${index}`));
    }
    await expect(repo.insert(page("sp_over", "acme-over"))).rejects.toThrow(
      /ZENGUY_COLLECTION_CAP_STATUS_PAGES/u,
    );
    await repo.insert(page("sp_ws2", "other-ws", { workspaceId: "ws_2" }));
  });
});

describe("D1StatusPageItemRepo", () => {
  beforeEach(freshDb);

  it("inserts, lists ordered by position, updates names, removes and reorders", async () => {
    const pages = new D1StatusPageRepo(testEnv().DB);
    const repo = new D1StatusPageItemRepo(testEnv().DB);
    await pages.insert(page("sp_a", "acme"));
    await repo.insert(item("spi_a", "sp_a", 0));
    await repo.insert(item("spi_b", "sp_a", 1, { displayName: "Checkout" }));
    await repo.insert(
      item("spi_c", "sp_a", 2, {
        resourceType: "BROWSER_TEST",
        browserTestId: "bt_1",
        uptimeMonitorId: null,
      }),
    );

    expect(
      (await repo.listForPage("sp_a")).map((entry) => entry.id),
    ).toEqual(["spi_a", "spi_b", "spi_c"]);
    expect((await repo.findById("sp_a", "spi_b"))?.displayName).toBe("Checkout");
    expect(await repo.findById("sp_other", "spi_b")).toBeNull();

    await repo.update("spi_b", { displayName: "Payments", groupName: "Shop" });
    const renamed = await repo.findById("sp_a", "spi_b");
    expect(renamed?.displayName).toBe("Payments");
    expect(renamed?.groupName).toBe("Shop");

    await repo.reorder("sp_a", ["spi_c", "spi_a", "spi_b"]);
    expect(
      (await repo.listForPage("sp_a")).map((entry) => entry.id),
    ).toEqual(["spi_c", "spi_a", "spi_b"]);

    await repo.remove("spi_a");
    expect((await repo.listForPage("sp_a")).map((entry) => entry.id)).toEqual([
      "spi_c",
      "spi_b",
    ]);
  });

  it("rejects the same resource twice on one page and caps items at 50", async () => {
    const repo = new D1StatusPageItemRepo(testEnv().DB);
    await repo.insert(item("spi_a", "sp_a", 0, { uptimeMonitorId: "mon_x" }));
    await expect(
      repo.insert(item("spi_dup", "sp_a", 1, { uptimeMonitorId: "mon_x" })),
    ).rejects.toThrow(/UNIQUE/u);
    // Same resource on a DIFFERENT page is fine.
    await repo.insert(item("spi_other", "sp_b", 0, { uptimeMonitorId: "mon_x" }));

    for (let index = 1; index < 50; index += 1) {
      await repo.insert(item(`spi_fill_${index}`, "sp_a", index + 1));
    }
    await expect(repo.insert(item("spi_over", "sp_a", 99))).rejects.toThrow(
      /ZENGUY_COLLECTION_CAP_STATUS_PAGE_ITEMS/u,
    );
  });

  it("removes items for a deleted resource across pages", async () => {
    const repo = new D1StatusPageItemRepo(testEnv().DB);
    await repo.insert(item("spi_a", "sp_a", 0, { uptimeMonitorId: "mon_x" }));
    await repo.insert(item("spi_b", "sp_b", 0, { uptimeMonitorId: "mon_x" }));
    await repo.insert(item("spi_keep", "sp_a", 1, { uptimeMonitorId: "mon_y" }));
    await repo.insert(
      item("spi_bt", "sp_a", 2, {
        resourceType: "BROWSER_TEST",
        browserTestId: "bt_1",
        uptimeMonitorId: null,
      }),
    );

    await repo.removeForResource({ uptimeMonitorId: "mon_x" });
    expect((await repo.listForPage("sp_a")).map((entry) => entry.id)).toEqual([
      "spi_keep",
      "spi_bt",
    ]);
    expect(await repo.listForPage("sp_b")).toEqual([]);

    await repo.removeForResource({ browserTestId: "bt_1" });
    expect((await repo.listForPage("sp_a")).map((entry) => entry.id)).toEqual([
      "spi_keep",
    ]);
  });
});

function incidentRow(input: {
  id: string;
  openedAt: number;
  resolvedAt?: number | null;
  workspaceId?: string;
  monitorId?: string;
}): Incident {
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? "ws_1",
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: input.monitorId ?? `mon_${input.id}`,
    status: (input.resolvedAt ?? null) === null ? "OPEN" : "RESOLVED",
    openedAt: input.openedAt,
    resolvedAt: input.resolvedAt ?? null,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: `chk_${input.id}`,
    resolvedByCheckId: null,
    lastEventAt: input.openedAt,
    createdAt: input.openedAt,
  };
}

describe("public read-model repo methods", () => {
  beforeEach(freshDb);

  it("lists incidents for the public window: open at any age plus recent ones", async () => {
    const repo = new D1IncidentRepo(testEnv().DB);
    const since = NOW - 90 * 86_400_000;
    await repo.insertOpen(
      incidentRow({ id: "inc_ancient_open", openedAt: NOW - 200 * 86_400_000 }),
    );
    await repo.insertOpen(incidentRow({ id: "inc_recent", openedAt: NOW - 1_000 }));
    const oldResolved = incidentRow({
      id: "inc_old_resolved",
      openedAt: NOW - 120 * 86_400_000,
    });
    await repo.insertOpen(oldResolved);
    await repo.resolve(oldResolved.id, NOW - 119 * 86_400_000, {});
    await repo.insertOpen(
      incidentRow({ id: "inc_foreign", openedAt: NOW, workspaceId: "ws_2" }),
    );

    const listed = await repo.listForPublicWindow("ws_1", since);
    expect(listed.map((entry) => entry.id)).toEqual([
      "inc_recent",
      "inc_ancient_open",
    ]);
  });

  it("findByIds returns only live monitors of the workspace", async () => {
    const database = testEnv().DB;
    const insert = (id: string, workspaceId: string, deletedAt: number | null) =>
      database
        .prepare(
          `INSERT INTO uptime_monitors
            (id, workspace_id, name, url, method, expected_status,
             frequency_seconds, timeout_seconds, max_retries,
             notify_on_recovery, next_check_at, current_status,
             created_at, updated_at, deleted_at)
           VALUES (?, ?, 'name', 'https://x.example.com', 'GET', 200,
                   300, 10, 0, 1, ?, 'UP', ?, ?, ?)`,
        )
        .bind(id, workspaceId, NOW, NOW, NOW, deletedAt)
        .run();
    await insert("mon_live", "ws_1", null);
    await insert("mon_dead", "ws_1", NOW);
    await insert("mon_foreign", "ws_2", null);

    const { D1MonitorRepo } = await import("./monitor_repo");
    const monitors = new D1MonitorRepo(database);
    const found = await monitors.findByIds("ws_1", [
      "mon_live",
      "mon_dead",
      "mon_foreign",
      "mon_missing",
    ]);
    expect(found.map((entry) => entry.id)).toEqual(["mon_live"]);
    expect(await monitors.findByIds("ws_1", [])).toEqual([]);
  });

  it("finds live tests with finished runs among the given ids", async () => {
    const database = testEnv().DB;
    const runs = new D1RunRepo(database);
    await database
      .prepare(
        `INSERT INTO test_runs
          (id, workspace_id, browser_test_id, source, status, snapshot_json,
           queued_at, started_at, finished_at, duration_ms, attempt_count,
           infra_attempts, passed_after_retry, billable, created_at)
         VALUES (?, ?, ?, 'SCHEDULED', 'PASSED', '{}', ?, ?, ?, 60000, 1, 0, 0, 1, ?)`,
      )
      .bind("run_done", "ws_1", "bt_done", NOW, NOW, NOW + 60_000, NOW)
      .run();
    await database
      .prepare(
        `INSERT INTO test_runs
          (id, workspace_id, browser_test_id, source, status, snapshot_json,
           queued_at, attempt_count, infra_attempts, passed_after_retry,
           billable, created_at)
         VALUES (?, ?, ?, 'SCHEDULED', 'QUEUED', '{}', ?, 0, 0, 0, 1, ?)`,
      )
      .bind("run_pending", "ws_1", "bt_pending", NOW, NOW)
      .run();

    const finished = await runs.testsWithFinishedRuns("ws_1", [
      "bt_done",
      "bt_pending",
      "bt_missing",
    ]);
    expect(finished).toEqual(new Set(["bt_done"]));
    expect(await runs.testsWithFinishedRuns("ws_1", [])).toEqual(new Set());
  });
});

describe("D1IncidentUpdateRepo", () => {
  beforeEach(freshDb);

  it("inserts, lists newest-first per incident and batch per workspace, finds scoped, removes", async () => {
    const repo = new D1IncidentUpdateRepo(testEnv().DB);
    await repo.insert(update("iu_old", "inc_1", NOW));
    await repo.insert(update("iu_new", "inc_1", NOW + 1_000));
    await repo.insert(update("iu_other", "inc_2", NOW + 2_000));
    await repo.insert(
      update("iu_foreign", "inc_3", NOW, { workspaceId: "ws_2" }),
    );

    expect(
      (await repo.listForIncident("inc_1")).map((entry) => entry.id),
    ).toEqual(["iu_new", "iu_old"]);

    const grouped = await repo.listForIncidents("ws_1", [
      "inc_1",
      "inc_2",
      "inc_3",
    ]);
    expect(grouped.get("inc_1")?.map((entry) => entry.id)).toEqual([
      "iu_new",
      "iu_old",
    ]);
    expect(grouped.get("inc_2")?.map((entry) => entry.id)).toEqual([
      "iu_other",
    ]);
    expect(grouped.get("inc_3")).toBeUndefined();
    expect(await repo.listForIncidents("ws_1", [])).toEqual(new Map());

    expect((await repo.findById("ws_1", "iu_old"))?.message).toBe(
      "Update iu_old",
    );
    expect(await repo.findById("ws_2", "iu_old")).toBeNull();

    await repo.remove("iu_new");
    expect(
      (await repo.listForIncident("inc_1")).map((entry) => entry.id),
    ).toEqual(["iu_old"]);
  });
});
