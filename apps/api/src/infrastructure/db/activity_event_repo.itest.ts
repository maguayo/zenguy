import type { ActivityEvent } from "../../domain/activity/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ActivityEventRepo } from "./activity_event_repo";

function event(
  id: string,
  occurredAt: number,
  overrides: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    id,
    type: "web.page_viewed",
    userId: "usr_actor",
    workspaceId: "ws_primary",
    source: "web",
    resourceType: null,
    resourceId: null,
    propertiesJson: '{"page":"/w/:wsId/overview"}',
    occurredAt,
    ...overrides,
  };
}

describe("D1ActivityEventRepo", () => {
  let repo: D1ActivityEventRepo;

  beforeEach(async () => {
    await freshDb();
    // freshDb() only learns about this table with the wiring commit; clearing
    // it here keeps the suite hermetic on either schema.
    await testEnv().DB.prepare("DELETE FROM activity_events").run();
    repo = new D1ActivityEventRepo(testEnv().DB);
  });

  it("inserts a single event and lists it back newest first", async () => {
    await repo.insert(event("act_1", 1_000));
    await repo.insert(
      event("act_2", 2_000, {
        type: "browser_test.viewed",
        resourceType: "browser_test",
        resourceId: "bt_1",
        source: "app",
      }),
    );

    const rows = await repo.listRecent(10);
    expect(rows.map((row) => row.id)).toEqual(["act_2", "act_1"]);
    expect(rows[0]).toEqual(
      event("act_2", 2_000, {
        type: "browser_test.viewed",
        resourceType: "browser_test",
        resourceId: "bt_1",
        source: "app",
      }),
    );
  });

  it("inserts many events in one batch and tolerates an empty batch", async () => {
    await repo.insertMany([]);
    await repo.insertMany([event("act_a", 10), event("act_b", 20), event("act_c", 30)]);
    expect((await repo.listRecent(10)).map((row) => row.id)).toEqual([
      "act_c",
      "act_b",
      "act_a",
    ]);
  });

  it("keeps null user and workspace for system and user-level events", async () => {
    await repo.insert(
      event("act_sys", 5, {
        type: "incident.opened",
        userId: null,
        source: "server",
        resourceType: "incident",
        resourceId: "inc_1",
        propertiesJson: null,
      }),
    );
    await repo.insert(
      event("act_login", 6, { type: "user.logged_in", workspaceId: null }),
    );
    const rows = await repo.listRecent(10);
    expect(rows.find((row) => row.id === "act_sys")?.userId).toBeNull();
    expect(rows.find((row) => row.id === "act_login")?.workspaceId).toBeNull();
  });

  it("rejects sources outside the catalog", async () => {
    await expect(
      repo.insert(event("act_bad", 1, { source: "ftp" as ActivityEvent["source"] })),
    ).rejects.toThrow(/CHECK constraint/u);
  });

  it("deletes only the listed types older than the cutoff, bounded by limit", async () => {
    await repo.insertMany([
      event("act_old_visit", 100),
      event("act_old_visit_2", 110),
      event("act_old_login", 120, { type: "user.logged_in", workspaceId: null }),
      event("act_new_visit", 5_000),
    ]);

    expect(await repo.deleteOlderThan(1_000, ["web.page_viewed"], 1)).toBe(1);
    expect(await repo.deleteOlderThan(1_000, ["web.page_viewed"], 10)).toBe(1);
    expect(await repo.deleteOlderThan(1_000, ["web.page_viewed"], 10)).toBe(0);
    expect(await repo.deleteOlderThan(1_000, [], 10)).toBe(0);

    const remaining = (await repo.listRecent(10)).map((row) => row.id).sort();
    expect(remaining).toEqual(["act_new_visit", "act_old_login"]);
  });
});
