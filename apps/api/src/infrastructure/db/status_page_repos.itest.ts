import type {
  IncidentUpdate,
  StatusPage,
  StatusPageItem,
} from "../../domain/status_pages/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1IncidentUpdateRepo } from "./incident_update_repo";
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
