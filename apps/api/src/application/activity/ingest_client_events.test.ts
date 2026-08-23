import { FixedClock } from "../../shared/clock";
import { FakeActivityEventRepo } from "../../test/fakes/activity";
import { FakeIds } from "../../test/fakes/ids";
import { FakeMemberRepo } from "../../test/fakes/repos";
import {
  IngestClientEvents,
  MAX_CLIENT_EVENTS_PER_BATCH,
} from "./ingest_client_events";

const NOW = 1_700_000_000_000;

async function seedMember(members: FakeMemberRepo, workspaceId: string, userId: string) {
  await members.insert({
    id: `mem_${workspaceId}_${userId}`,
    workspaceId,
    userId,
    role: "MEMBER",
    invitedBy: null,
    joinedAt: NOW,
  });
}

function ingestor() {
  const activity = new FakeActivityEventRepo();
  const members = new FakeMemberRepo();
  const ingest = new IngestClientEvents({
    activity,
    members,
    clock: new FixedClock(NOW),
    ids: new FakeIds(),
  });
  return { activity, members, ingest };
}

describe("IngestClientEvents", () => {
  it("stores visits for workspaces the user belongs to, in one batch", async () => {
    const { activity, members, ingest } = ingestor();
    await seedMember(members, "ws_1", "usr_1");

    const result = await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [
        { type: "web.page_viewed", workspaceId: "ws_1", properties: { page: "/w/:wsId/overview" } },
        { type: "browser_test.viewed", workspaceId: "ws_1", resourceId: "bt_1", properties: { page: "/w/:wsId/tests/:testId" } },
        { type: "app.opened" },
      ],
    });

    expect(result).toEqual({ accepted: 3, dropped: 0 });
    expect(activity.events.map((event) => [event.type, event.workspaceId, event.resourceType, event.resourceId, event.source, event.userId, event.occurredAt])).toEqual([
      ["web.page_viewed", "ws_1", null, null, "web", "usr_1", NOW],
      ["browser_test.viewed", "ws_1", "browser_test", "bt_1", "web", "usr_1", NOW],
      ["app.opened", null, null, null, "web", "usr_1", NOW],
    ]);
  });

  it("drops events for workspaces the user is not a member of, silently", async () => {
    const { activity, members, ingest } = ingestor();
    await seedMember(members, "ws_mine", "usr_1");
    const result = await ingest.execute({
      userId: "usr_1",
      source: "app",
      events: [
        { type: "web.page_viewed", workspaceId: "ws_other" },
        { type: "run.viewed", workspaceId: "ws_other", resourceId: "run_1" },
        { type: "web.page_viewed", workspaceId: "ws_mine" },
      ],
    });
    expect(result).toEqual({ accepted: 1, dropped: 2 });
    expect(activity.events.map((event) => event.workspaceId)).toEqual(["ws_mine"]);
  });

  it("drops unknown types, server-only types and scope violations", async () => {
    const { activity, members, ingest } = ingestor();
    await seedMember(members, "ws_1", "usr_1");
    const result = await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [
        { type: "browser_test.created", workspaceId: "ws_1", resourceId: "bt_1" },
        { type: "user.logged_in" },
        { type: "made.up", workspaceId: "ws_1" },
        { type: "browser_test.viewed" },
        { type: "incident.viewed", workspaceId: "ws_1", resourceId: "inc_1" },
      ],
    });
    expect(result).toEqual({ accepted: 1, dropped: 4 });
    expect(activity.events.map((event) => event.type)).toEqual(["incident.viewed"]);
  });

  it("looks up membership once per workspace", async () => {
    const { members, ingest } = ingestor();
    await seedMember(members, "ws_1", "usr_1");
    const spy = vi.spyOn(members, "find");
    await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [
        { type: "web.page_viewed", workspaceId: "ws_1" },
        { type: "web.page_viewed", workspaceId: "ws_1" },
        { type: "web.page_viewed", workspaceId: "ws_2" },
        { type: "web.page_viewed", workspaceId: "ws_2" },
      ],
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when every event is dropped", async () => {
    const { activity, ingest } = ingestor();
    const spy = vi.spyOn(activity, "insertMany");
    const result = await ingest.execute({
      userId: "usr_1",
      source: "web",
      events: [{ type: "nope" }],
    });
    expect(result).toEqual({ accepted: 0, dropped: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("enforces the batch cap at the application boundary", async () => {
    const { activity, ingest } = ingestor();
    const events = Array.from(
      { length: MAX_CLIENT_EVENTS_PER_BATCH + 7 },
      (_, index) => ({
        type: "app.opened",
        properties: { index },
      }),
    );

    await expect(
      ingest.execute({ userId: "usr_1", source: "app", events }),
    ).resolves.toEqual({ accepted: MAX_CLIENT_EVENTS_PER_BATCH, dropped: 7 });
    expect(activity.events).toHaveLength(MAX_CLIENT_EVENTS_PER_BATCH);
  });
});
