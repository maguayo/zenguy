import { FixedClock } from "../../shared/clock";
import { FakeActivityEventRepo } from "../../test/fakes/activity";
import { FakeIds } from "../../test/fakes/ids";
import { buildActivityEvent, TrackEvent } from "./track_event";

const NOW = 1_700_000_000_000;

function tracker(repo = new FakeActivityEventRepo()) {
  return {
    repo,
    track: new TrackEvent({ activity: repo, clock: new FixedClock(NOW), ids: new FakeIds() }),
  };
}

describe("TrackEvent", () => {
  it("stores a workspace event with the catalog resource type and sanitized properties", async () => {
    const { repo, track } = tracker();
    await track.execute({
      type: "browser_test.created",
      userId: "usr_1",
      workspaceId: "ws_1",
      source: "server",
      resourceId: "bt_1",
      properties: { name: "Checkout flow", password: "nope", count: 2 },
    });

    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]).toEqual({
      id: "act_00000000000000000000000001",
      type: "browser_test.created",
      userId: "usr_1",
      workspaceId: "ws_1",
      source: "server",
      resourceType: "browser_test",
      resourceId: "bt_1",
      propertiesJson: JSON.stringify({ name: "Checkout flow", password: "***", count: 2 }),
      occurredAt: NOW,
    });
  });

  it("leaves resource columns null when no resourceId is given", async () => {
    const { repo, track } = tracker();
    await track.execute({
      type: "browser_test.run_passed",
      userId: null,
      workspaceId: "ws_1",
      source: "server",
      properties: { runId: "run_1", runSource: "VALIDATION" },
    });
    expect(repo.events[0]?.resourceType).toBeNull();
    expect(repo.events[0]?.resourceId).toBeNull();
    expect(repo.events[0]?.userId).toBeNull();
  });

  it("caps serialized properties at 2000 characters and stores null when absent", async () => {
    const { repo, track } = tracker();
    await track.execute({
      type: "user.logged_in",
      userId: "usr_1",
      source: "web",
      properties: { page: "x".repeat(5_000) },
    });
    await track.execute({ type: "user.logged_out", userId: "usr_1", source: "app" });
    expect(repo.events[0]?.propertiesJson?.length).toBeLessThanOrEqual(2_000);
    expect(JSON.parse(repo.events[0]?.propertiesJson ?? "")).toMatchObject({
      truncated: true,
      preview: expect.any(String),
    });
    expect(repo.events[1]?.propertiesJson).toBeNull();
    expect(repo.events[1]?.workspaceId).toBeNull();
  });

  it("drops events that violate the catalog scope instead of throwing", async () => {
    const { repo, track } = tracker();
    await track.execute({ type: "browser_test.viewed", userId: "usr_1", source: "web" });
    await track.execute({
      type: "user.logged_in",
      userId: "usr_1",
      workspaceId: "ws_1",
      source: "web",
    });
    await track.execute({
      type: "not.a_type" as never,
      userId: "usr_1",
      source: "web",
    });
    expect(repo.events).toHaveLength(0);
  });

  it("never throws when the repository fails", async () => {
    const failing = new FakeActivityEventRepo();
    failing.failNextInsert = true;
    const { track } = tracker(failing);
    await expect(
      track.execute({ type: "user.logged_in", userId: "usr_1", source: "web" }),
    ).resolves.toBeUndefined();
  });
});

describe("buildActivityEvent", () => {
  const deps = { clock: new FixedClock(NOW), ids: new FakeIds() };

  it("returns null for a workspace-scoped type without workspace", () => {
    expect(
      buildActivityEvent({ type: "run.viewed", userId: "u", source: "web", resourceId: "run_1" }, deps),
    ).toBeNull();
  });

  it("accepts any-scoped types with or without workspace", () => {
    expect(
      buildActivityEvent({ type: "web.page_viewed", userId: "u", source: "web" }, deps)?.workspaceId,
    ).toBeNull();
    expect(
      buildActivityEvent(
        { type: "web.page_viewed", userId: "u", workspaceId: "ws_1", source: "web" },
        deps,
      )?.workspaceId,
    ).toBe("ws_1");
  });
});
